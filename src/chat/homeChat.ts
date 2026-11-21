import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getChatRepo, getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';
import { trashItem } from '../platform';
import { chatHost } from './host';
import { HOME_CHAT_INSTRUCTIONS } from './homeChatInstructions';
import {
  HOME_CHAT_ID_PREFIX,
  HOME_CHAT_SETTING_KEYS,
  UNTITLED_HOME_CHAT,
  parseHomeChatSettings,
  taskKey,
  taskOfKey,
  titleFromMessage,
  type HomeChatSettings,
  type HomeChatState,
  type HomeChatSummary,
} from './preferences';
import type { ChatSessionInfo, ChatSnapshot } from './model';

const chatLog = getLogger().scope('chat:home');

/** One of Chat's conversations, by the role its session was created with. */
export function isHomeChat(id: string): boolean {
  return chatHost.roleOf(id) === 'home';
}

/**
 * Whether an API caller is Chat. A session's token lives as long as its
 * agent, so a caller is always a running session, and nothing stored is read.
 */
export function callerIsHomeChat(id: string): boolean {
  return chatHost.list().some((info) => info.id === id && info.role === 'home');
}

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

/**
 * A conversation's own folder, where its agent works and what its sandbox
 * grants. Chat's settings, sandbox ones included, are kept against
 * `homeChatDir()`, which every conversation shares as its project.
 */
export function conversationDir(id: string): string {
  return path.join(homeChatDir(), 'conversations', id);
}

let current: string | null = null;
const listeners = new Set<(state: HomeChatState) => void>();

/** The conversation Chat is in: the one chosen last, else the newest stored, else a new one. */
export async function currentHomeChatId(): Promise<string> {
  if (current) return current;
  const chosen = await getGlobalSetting(HOME_CHAT_SETTING_KEYS.current);
  current = chosen && isHomeChat(chosen) ? chosen : (getChatRepo().listHome()[0]?.id ?? newId());
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
  const live = chatHost.snapshot(id)?.nodes.findLast((node) => node.kind === 'user_message')?.createdAt;
  const activeAt = live ?? getChatRepo().lastTurnAt(id) ?? Date.parse(createdAt);
  return { id, title: info.label || UNTITLED_HOME_CHAT, createdAt, activeAt };
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
    chats.push(summary(currentId, live.info, new Date().toISOString()));
  }
  // Most recently active first, so a conversation still going does not sink as new ones start.
  chats.sort((a, b) => b.activeAt - a.activeAt);
  const owners = Object.fromEntries(
    getChatRepo()
      .taskOwners()
      .map((owner) => [taskKey(owner.projectPath, owner.taskNumber), owner.chatId]),
  );
  const following = Object.fromEntries(
    [currentId, ...chats.map((chat) => chat.id)].map((id) => [
      id,
      getChatRepo()
        .following(id)
        .flatMap((subject) => taskOfKey(subject) ?? []),
    ]),
  );
  // A conversation is listed once it has been asked something; until then it is only where the plus leads.
  return { currentId, chats: chats.filter((chat) => chat.title !== UNTITLED_HOME_CHAT), owners, following };
}

export function onHomeChatChange(listener: (state: HomeChatState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tell the window what Chat's conversations are and what they follow, after either changes. */
export async function announce(): Promise<void> {
  const state = await homeChatState();
  for (const listener of listeners) listener(state);
}

async function choose(id: string): Promise<void> {
  current = id;
  await setGlobalSetting(HOME_CHAT_SETTING_KEYS.current, id);
}

async function startConversation(id: string, eager: boolean | undefined): Promise<ChatSnapshot> {
  const dir = conversationDir(id);
  const [settings] = await Promise.all([loadHomeChatSettings(), fs.mkdir(dir, { recursive: true })]);
  const snapshot = await chatHost.start({
    id,
    agent: settings.agent,
    projectPath: homeChatDir(),
    cwd: dir,
    taskId: null,
    sandboxProvider: settings.sandbox,
    label: UNTITLED_HOME_CHAT,
    instructions: [HOME_CHAT_INSTRUCTIONS, settings.instructions.trim()].filter(Boolean).join('\n\n'),
    role: 'home',
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
    if (info.role !== 'home' || info.id === id) continue;
    chatHost
      .stop(info.id)
      .catch((error) => chatLog.warn('conversation did not stop', { id: info.id, error: String(error) }));
  }
}

/** `id` lets the caller show the conversation before this returns; it has to be new. */
export async function newHomeChat(id = newId()): Promise<ChatSnapshot> {
  if (chatHost.roleOf(id)) throw new Error(`There is already a session ${id}`);
  await choose(id);
  stopOthers(id);
  return startConversation(id, true);
}

export async function switchHomeChat(id: string): Promise<ChatSnapshot> {
  if (!isHomeChat(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
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
 * Its transcript gone for good, and its folder to the system Trash. Deleting
 * the open conversation moves to the most recent other one, or to a new one
 * when it was the last.
 */
export async function deleteHomeChat(id: string): Promise<HomeChatState> {
  if (!isHomeChat(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  const wasCurrent = (await currentHomeChatId()) === id;
  await chatHost.discard(id);
  await trashFolder(conversationDir(id));
  getChatRepo().unfollowAll(id);
  if (wasCurrent) {
    const next = getChatRepo().listHome()[0]?.id ?? newId();
    await choose(next);
    await startConversation(next, true);
  }
  await announce();
  return homeChatState();
}

export async function renameHomeChat(id: string, title: string): Promise<void> {
  if (!isHomeChat(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  const trimmed = title.trim();
  if (!trimmed) throw new Error('A title cannot be empty');
  if (!chatHost.setLabel(id, trimmed)) throw new Error(`No conversation ${id}`);
  await announce();
}

/**
 * A conversation takes its title from the first thing it was asked, cut
 * short at once and then summed up by its agent, and
 * `/clear` in one starts another rather than emptying it. Once per process.
 */
export function installHomeChat(): void {
  chatHost.onClear = clearStartsAnother;
  chatHost.subscribe((sessionId, { event }) => {
    if (event.type !== 'node' || !isHomeChat(sessionId)) return;
    const node = event.node;
    if (node.kind !== 'user_message') return;
    // A turn beginning, typed or woken, moves its conversation up the list.
    void announce();
    if (node.wake) return;
    const info = chatHost.snapshot(sessionId)?.info;
    if (!info || (info.label && info.label !== UNTITLED_HOME_CHAT)) return;
    const placeholder = titleFromMessage(node.text);
    chatHost.setLabel(sessionId, placeholder);
    void announce();
    void chatHost.suggestTitle(sessionId, node.text).then((title) => {
      // Unless the user renamed it meanwhile.
      if (!title || chatHost.snapshot(sessionId)?.info.label !== placeholder) return;
      chatHost.setLabel(sessionId, title);
      void announce();
    });
  });
}

async function trashFolder(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  try {
    await trashItem(dir);
  } catch (error) {
    chatLog.warn('conversation folder was not trashed', { dir, error: String(error) });
  }
}

async function clearStartsAnother(id: string): Promise<boolean> {
  if (!isHomeChat(id)) return false;
  await newHomeChat();
  return true;
}

/**
 * The conversation that started a task hears about it and holds what its
 * worker leaves for the user. The owner row references the conversation's,
 * which a conversation opened a moment ago may not have written yet.
 */
export function ownTask(conversation: string, projectPath: string, taskNumber: number): void {
  chatHost.flush(conversation);
  getChatRepo().setTaskOwner(projectPath, taskNumber, conversation);
  void announce();
}

export function taskOwner(projectPath: string, taskNumber: number): string | null {
  return getChatRepo().taskOwner(projectPath, taskNumber);
}
