import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getChatRepo, getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';
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

function summary(id: string, info: ChatSessionInfo, updatedAt: string): HomeChatSummary {
  return { id, title: info.label || UNTITLED_HOME_CHAT, updatedAt };
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
        row.updated_at,
      ),
    );
  const live = chatHost.snapshot(currentId);
  if (live && !chats.some((chat) => chat.id === currentId)) {
    chats.unshift(summary(currentId, live.info, new Date().toISOString()));
  }
  // The one open is the most recent, whatever a stop's final flush wrote after it.
  chats.sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
  return { currentId, chats };
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

export async function newHomeChat(): Promise<ChatSnapshot> {
  const id = newId();
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
