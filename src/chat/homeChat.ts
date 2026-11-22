import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { deleteGlobalSetting, getChatRepo, getGlobalSetting, setGlobalSetting } from '../db';
import { getLogger } from '../logger';
import { getUserDataPath } from '../paths';
import { trashItem } from '../platform';
import { chatHost } from './host';
import { HOME_CHAT_INSTRUCTIONS } from './homeChatInstructions';
import {
  CHAT_SETTING_KEYS,
  HOME_CHAT_ID_PREFIX,
  HOME_CHAT_SETTING_KEYS,
  UNTITLED_HOME_CHAT,
  homeChatPanelsKey,
  parseHomeChatSettings,
  taskKey,
  taskOfKey,
  titleFromMessage,
  type HomeChatSettings,
  type HomeChatState,
  type HomeChatSummary,
} from './preferences';
import { stillWorking, type ChatSessionInfo, type ChatSnapshot } from './model';

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
  const working = chatHost.isLive(id) && stillWorking(info);
  return { id, title: info.label || UNTITLED_HOME_CHAT, createdAt, activeAt, working };
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

/** `id` lets the caller show the conversation before this returns; it has to be new. */
export async function newHomeChat(id = newId()): Promise<ChatSnapshot> {
  if (chatHost.roleOf(id)) throw new Error(`There is already a session ${id}`);
  await choose(id);
  return startConversation(id, true);
}

/** Every conversation keeps running while another is on screen; this only changes which one that is. */
export async function switchHomeChat(id: string): Promise<ChatSnapshot> {
  if (!isHomeChat(id)) throw new Error(`Not one of Chat's conversations: ${id}`);
  await choose(id);
  return startConversation(id, true);
}

/** A conversation not running, started to take what it has been sent. */
export async function resumeHomeChat(id: string): Promise<void> {
  if (!isHomeChat(id) || chatHost.isLive(id)) return;
  if ((await getGlobalSetting(CHAT_SETTING_KEYS.enabled)) !== '1') return;
  await startConversation(id, true);
}

/** Its agent again on the conversation on screen, after it stopped or failed. */
export async function restartHomeChat(): Promise<ChatSnapshot> {
  const id = await currentHomeChatId();
  await chatHost.stop(id);
  return startConversation(id, true);
}

const restartWhenFree = new Set<string>();

/**
 * Agent, sandbox and instructions reach an agent only at launch, so a
 * settings change restarts every running conversation: now if it is free,
 * else once its work is over, since restarting ends whatever it left running.
 * One not running takes the new settings when it next starts.
 */
export async function reconfigureHomeChats(): Promise<ChatSnapshot> {
  await Promise.all(
    chatHost.list().flatMap((info) => {
      if (info.role !== 'home') return [];
      if (!stillWorking(info)) return [restartConversation(info.id)];
      restartWhenFree.add(info.id);
      return [];
    }),
  );
  const id = await currentHomeChatId();
  return chatHost.snapshot(id) ?? startConversation(id, true);
}

/** Held for a restart: what it is sent waits until it is back. */
export function restartingHomeChat(id: string): boolean {
  return restartWhenFree.has(id);
}

async function restartConversation(id: string): Promise<void> {
  restartWhenFree.delete(id);
  await chatHost.stop(id);
  await startConversation(id, true);
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
  deleteGlobalSetting(homeChatPanelsKey(id));
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
    if (!isHomeChat(sessionId)) return;
    if (event.type === 'session' && (event.patch.status !== undefined || event.patch.background !== undefined)) {
      const info = chatHost.snapshot(sessionId)?.info;
      if (info && restartWhenFree.has(sessionId) && !stillWorking(info) && info.status !== 'starting') {
        void restartConversation(sessionId);
      }
      // Whether it is working shows on its row.
      void announce();
      return;
    }
    if (event.type !== 'node') return;
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
