import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getChatRepo, getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';
import { hostEnv } from '../sessionEnv';
import { chatHost } from './host';
import { HOME_CHAT_INSTRUCTIONS } from './homeChatInstructions';
import {
  HOME_CHAT_ID_PREFIX,
  HOME_CHAT_SETTING_KEYS,
  UNTITLED_HOME_CHAT,
  isHomeChatId,
  parseHomeChatSettings,
  titleFromMessage,
  type HomeChatSettings,
  type HomeChatState,
  type HomeChatSummary,
} from './preferences';
import type { ChatAgentId, ChatSessionInfo, ChatSnapshot } from './model';

const execFileAsync = promisify(execFile);
const chatLog = getLogger().scope('chat:home');

/** In a sandbox nothing asks first: the sandbox is the boundary. Agents without such a mode keep their own approvals. */
const UNATTENDED_MODE: Partial<Record<ChatAgentId, string>> = { claude: 'bypassPermissions', codex: 'never' };

export function homeChatDir(): string {
  return path.join(getUserDataPath(), 'chat');
}

export async function loadHomeChatSettings(): Promise<HomeChatSettings> {
  const stored = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(HOME_CHAT_SETTING_KEYS).map(async (key) => stored.set(key, await getGlobalSetting(key))),
  );
  return parseHomeChatSettings((key) => stored.get(key));
}

/** The sandboxes grant a checkout and its `.git`, so Chat's home is a repository with nothing in it. */
async function ensureHomeChatDir(): Promise<string> {
  const dir = homeChatDir();
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(path.join(dir, '.git'));
  } catch {
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
  }
  return dir;
}

let current: string | null = null;
const listeners = new Set<(state: HomeChatState) => void>();

/** The conversation Chat is in: the one chosen last, else the newest stored, else a new one. */
export async function currentHomeChatId(): Promise<string> {
  if (current) return current;
  const chosen = await getGlobalSetting(HOME_CHAT_SETTING_KEYS.current);
  current = chosen && isHomeChatId(chosen) ? chosen : (getChatRepo().listHome()[0]?.id ?? newId());
  return current;
}

export function _resetHomeChatForTesting(): void {
  current = null;
}

/** Synchronous, for callers on the event path; null until the first start. */
export function homeChatCurrent(): string | null {
  return current;
}

function newId(): string {
  return `${HOME_CHAT_ID_PREFIX}${randomUUID()}`;
}

function summary(id: string, info: ChatSessionInfo, createdAt: string): HomeChatSummary {
  return { id, title: info.label || UNTITLED_HOME_CHAT, createdAt };
}

/** Stored rows lag a running session by a flush, so a live session's own info wins. */
export async function homeChatState(): Promise<HomeChatState> {
  const currentId = await currentHomeChatId();
  const chats = getChatRepo()
    .listHome()
    .map((row) =>
      summary(
        row.id,
        chatHost.isLive(row.id) ? chatHost.snapshot(row.id)!.info : (JSON.parse(row.info) as ChatSessionInfo),
        row.created_at,
      ),
    );
  const live = chatHost.snapshot(currentId);
  if (live && !chats.some((chat) => chat.id === currentId)) {
    chats.unshift(summary(currentId, live.info, new Date().toISOString()));
  }
  // A conversation is listed once it has been asked something; until then it is only where the plus leads.
  return { currentId, chats: chats.filter((chat) => chat.title !== UNTITLED_HOME_CHAT) };
}

export function onHomeChatChange(listener: (state: HomeChatState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function announce(): Promise<void> {
  const state = await homeChatState();
  for (const listener of listeners) listener(state);
}

async function choose(id: string): Promise<void> {
  current = id;
  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.current, id);
}

async function startConversation(id: string, eager: boolean | undefined): Promise<ChatSnapshot> {
  const [settings, dir] = await Promise.all([loadHomeChatSettings(), ensureHomeChatDir()]);
  const snapshot = await chatHost.start({
    id,
    agent: settings.agent,
    projectPath: dir,
    cwd: dir,
    taskId: null,
    sandboxProvider: settings.sandbox,
    label: UNTITLED_HOME_CHAT,
    instructions: [HOME_CHAT_INSTRUCTIONS, settings.instructions.trim()].filter(Boolean).join('\n\n'),
    cliAccess: 'all',
    ...(settings.sandbox !== 'none' && { mode: UNATTENDED_MODE[settings.agent] }),
    reconfigure: true,
    eager,
  });
  void announce();
  return snapshot;
}

/** Start Chat's current conversation, or resume it, under its settings. */
export async function startHomeChat(options: { eager?: boolean } = {}): Promise<ChatSnapshot> {
  return startConversation(await currentHomeChatId(), options.eager);
}

/**
 * One conversation runs at a time: the others' agents are stopped, their
 * transcripts kept. An agent takes a moment to exit, so the one coming up is
 * not kept waiting for it; the one going down takes no more turns meanwhile,
 * since wakes go to the current conversation and the user has left it.
 */
function stopOthers(id: string): void {
  for (const info of chatHost.list()) {
    if (!isHomeChatId(info.id) || info.id === id) continue;
    chatHost
      .stop(info.id)
      .catch((error) => chatLog.warn('conversation did not stop', { id: info.id, error: String(error) }));
  }
}

/** `id` lets the caller show the conversation before this returns. */
export async function newHomeChat(id = newId()): Promise<ChatSnapshot> {
  if (!isHomeChatId(id)) throw new Error(`Not an id for Chat's conversations: ${id}`);
  await choose(id);
  stopOthers(id);
  return startConversation(id, true);
}

export async function switchHomeChat(id: string): Promise<ChatSnapshot> {
  if (!isHomeChatId(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  await choose(id);
  stopOthers(id);
  return startConversation(id, true);
}

/** A settings change restarts the agent on the same conversation. */
export async function restartHomeChat(): Promise<ChatSnapshot> {
  const id = await currentHomeChatId();
  await chatHost.stop(id);
  return startConversation(id, true);
}

/**
 * Gone for good, transcript included. Deleting the open conversation moves to
 * the most recent other one, or to a new one when it was the last.
 */
export async function deleteHomeChat(id: string): Promise<HomeChatState> {
  if (!isHomeChatId(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  const wasCurrent = (await currentHomeChatId()) === id;
  await chatHost.discard(id);
  if (wasCurrent) {
    const next = getChatRepo().listHome()[0]?.id ?? newId();
    await choose(next);
    await startConversation(next, true);
  }
  await announce();
  return homeChatState();
}

export async function renameHomeChat(id: string, title: string): Promise<void> {
  if (!isHomeChatId(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  const trimmed = title.trim();
  if (!trimmed) throw new Error('A title cannot be empty');
  if (!chatHost.setLabel(id, trimmed)) throw new Error(`No conversation ${id}`);
  await announce();
}

/**
 * A conversation takes its title from the first thing it was asked, and
 * `/clear` in one starts another rather than emptying it. Once per process.
 */
export function installHomeChat(): void {
  chatHost.onClear = clearStartsAnother;
  chatHost.subscribe((sessionId, { event }) => {
    if (!isHomeChatId(sessionId) || event.type !== 'node') return;
    const node = event.node;
    if (node.kind !== 'user_message' || node.wake) return;
    const info = chatHost.snapshot(sessionId)?.info;
    if (!info || (info.label && info.label !== UNTITLED_HOME_CHAT)) return;
    chatHost.setLabel(sessionId, titleFromMessage(node.text));
    void announce();
  });
}

async function clearStartsAnother(id: string): Promise<boolean> {
  if (!isHomeChatId(id)) return false;
  await newHomeChat();
  return true;
}

const ASK_OUTPUT_LINES = 100;

/**
 * Run a command Chat asked for, once the user has pressed Run. Chat has no
 * terminal to hold a runner, so it runs without one: no input, so a command
 * that prompts gets an end of file rather than waiting on nobody.
 */
export function runHomeChatAsk(command: string, cwd: string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...hostEnv(), PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 200_000) output = output.slice(-100_000);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const finish = (exitCode: number | null) =>
      resolve({ exitCode, output: output.split('\n').slice(-ASK_OUTPUT_LINES).join('\n').trimEnd() });
    child.on('error', (error) => {
      output += `${error.message}\n`;
      finish(null);
    });
    child.on('close', finish);
  });
}
