import log from 'electron-log/renderer';
import { OuijitTerminal, resolveTerminalLabel } from '../terminal/terminalReact';
import { registerTerminal, spawnRunner, buildWorktreeStartEnv, applyInitialUiState } from '../terminal/terminalActions';
import { terminalInstances } from '../terminal/terminalRegistry';
import { useChatStore, listenForChatEvents } from '../../stores/chatStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { descriptionToHookPrompt } from '../../utils/descriptionAttachments';
import { generateId } from '../../utils/ids';
import { isActiveSandbox } from '../../sandbox/types';
import { CHAT_SETTING_KEYS, isHomeChatId, parseChatSettings, type ChatSettings } from '../../chat/preferences';
import { listenForHomeChat, useHomeChatStore } from '../../stores/homeChatStore';
import { useAppStore } from '../../stores/appStore';
import type { ChatAgentId, ChatAttachment, ChatSessionStatus, SequencedChatEvent } from '../../chat/model';
import type { SandboxProviderId, SnapshotTerminalUi, TaskWithWorkspace } from '../../types';
import type { ChatDelivery } from '../../chat/host';

const chatLog = log.scope('chatActions');

export async function loadChatSettings(): Promise<ChatSettings> {
  const values = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(CHAT_SETTING_KEYS).map(async (key) => values.set(key, await window.api.globalSettings.get(key))),
  );
  return parseChatSettings((key) => values.get(key));
}

/** A chat's status, as the card's status dot reads it: waiting on a person counts as ready for one. */
function cardStatus(status: ChatSessionStatus): 'thinking' | 'ready' | 'error' | null {
  switch (status) {
    case 'running':
      return 'thinking';
    case 'idle':
    case 'awaiting':
      return 'ready';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

function forwardStatus(id: string, event: SequencedChatEvent): void {
  if (event.event.type !== 'session' || !event.event.patch.status) return;
  const status = cardStatus(event.event.patch.status);
  const instance = terminalInstances.get(id);
  if (status && instance?.surface === 'chat') instance.setAgentStatus(status);
}

/** Start feeding chat events to the store and the cards. Call once at startup. */
export function initChat(): void {
  listenForChatEvents(forwardStatus);
  listenForHomeChat();
  void loadChatSettings();
  void startHomeChat();
}

/** Chat runs from launch, so it hears about work it did not start. */
export async function startHomeChat(): Promise<void> {
  try {
    useChatStore.getState().adopt(await window.api.homeChat.start());
    useHomeChatStore.getState().set(await window.api.homeChat.list());
  } catch (error) {
    chatLog.error('chat failed to start', { error: String(error) });
  }
}

export async function newHomeChat(): Promise<void> {
  try {
    useChatStore.getState().adopt(await window.api.homeChat.create());
    useAppStore.getState().select({ kind: 'chat', page: 'chat' });
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

/** Open one of Chat's conversations, resuming its agent in place of the current one's. */
export async function openHomeChat(id: string): Promise<void> {
  useAppStore.getState().select({ kind: 'chat', page: 'chat' });
  const store = useHomeChatStore.getState();
  if (id === store.currentId) return;
  // Shown at once, from its stored transcript; the agent catches up behind it.
  store.set({ currentId: id, chats: store.chats });
  try {
    useChatStore.getState().adopt(await window.api.homeChat.switch(id));
  } catch (error) {
    useProjectStore.getState().addToast(String(error), 'error');
  }
}

export interface SetupCommand {
  name: string;
  command: string;
  hookType: 'start' | 'continue';
  sandboxProvider?: SandboxProviderId;
}

export interface AddChatCardOptions {
  /** The card and session id. A stored session under it resumes. */
  id?: string;
  agent?: ChatAgentId;
  worktree?: { path: string; branch: string };
  taskId?: number;
  sandboxProvider?: SandboxProviderId;
  label?: string;
  background?: boolean;
  replaceLoadingId?: string;
  /** Run before the first prompt goes out, in a runner panel on the card. */
  setup?: SetupCommand;
  /** Sent as the first message; the task description when a task starts. */
  firstPrompt?: string;
  /** Pick up the task's most recent chat rather than starting a new one. */
  resumeLatest?: boolean;
  initialUiState?: SnapshotTerminalUi;
}

/** Open a chat card. Resolves false when the agent could not be started at all. */
export async function addChatCard(projectPath: string, options: AddChatCardOptions = {}): Promise<boolean> {
  const settings = await loadChatSettings();
  let task: TaskWithWorkspace | null = null;
  if (options.taskId != null) task = await window.api.task.getByNumber(projectPath, options.taskId);

  let id = options.id;
  let agent = options.agent ?? settings.agent;
  const sandboxProvider = isActiveSandbox(options.sandboxProvider) ? options.sandboxProvider : undefined;
  if (!id && options.resumeLatest && options.taskId != null) {
    const latest = await window.api.chat.latestForTask(projectPath, options.taskId);
    // A conversation stays where it started, so another sandbox means a new one.
    if (latest && (latest.info.sandbox ?? undefined) === sandboxProvider) {
      id = latest.info.id;
      agent = latest.info.agent;
    }
  }
  id ??= generateId('pty');

  const label = options.label ?? resolveTerminalLabel(task?.name, options.worktree?.branch, undefined);
  const term = new OuijitTerminal({
    ptyId: id,
    projectPath,
    label,
    sandboxProvider,
    taskId: options.taskId ?? null,
    taskPrompt: task?.prompt,
    worktreePath: options.worktree?.path,
    worktreeBranch: options.worktree?.branch,
    mergeTarget: task?.mergeTarget,
    surface: 'chat',
    chatAgent: agent,
  });
  registerTerminal(
    term,
    projectPath,
    {
      label,
      sandboxProvider,
      taskId: options.taskId ?? null,
      worktreeBranch: options.worktree?.branch ?? null,
      surface: 'chat',
      chatAgent: agent,
    },
    options.background,
    options.replaceLoadingId,
  );
  term.bindChat(id);
  term.setAgentStatus('ready');
  void term.refreshGitStatus();
  if (options.initialUiState) await applyInitialUiState(term, options.initialUiState);

  const cwd = options.worktree?.path ?? projectPath;
  let started: Awaited<ReturnType<typeof window.api.chat.start>>;
  try {
    started = await window.api.chat.start({
      id,
      agent,
      projectPath,
      cwd,
      taskId: options.taskId ?? null,
      worktreePath: options.worktree?.path,
      sandboxProvider,
      label,
    });
  } catch (error) {
    chatLog.error('chat failed to start', { error: String(error) });
    useProjectStore.getState().addToast(`Chat failed to start: ${String(error)}`, 'error');
    return false;
  }
  useChatStore.getState().adopt(started);

  const firstPrompt = options.firstPrompt?.trim();
  if (options.setup) {
    void runSetupThenPrompt(term, options.setup, firstPrompt);
  } else if (firstPrompt) {
    await sendChat(id, firstPrompt);
  }
  return true;
}

/**
 * The start hook in a chat card does setup only: it runs in a runner panel
 * beside the chat, and the first prompt waits for it to succeed.
 */
async function runSetupThenPrompt(
  term: OuijitTerminal,
  setup: SetupCommand,
  firstPrompt: string | undefined,
): Promise<void> {
  const id = term.ptyId;
  if (firstPrompt) useChatStore.getState().setSetup(id, { text: firstPrompt, status: 'running' });
  const panelId = term.addRunnerPanel(
    { name: setup.name, command: setup.command, source: 'hook', sandboxProvider: setup.sandboxProvider },
    true,
  );
  term.updatePanel(panelId, { hookType: setup.hookType });
  term.setPanelFullWidth(false);
  await spawnRunner(id, panelId);
  const status = await new Promise<'success' | 'error'>((resolve) => {
    const read = () => {
      const panel = useTerminalStore.getState().displayStates[id]?.panels.find((p) => p.id === panelId);
      if (!panel) return 'error';
      return panel.kind === 'runner' && (panel.status === 'success' || panel.status === 'error') ? panel.status : null;
    };
    const now = read();
    if (now) return resolve(now);
    const stop = useTerminalStore.subscribe(() => {
      const next = read();
      if (next) {
        stop();
        resolve(next);
      }
    });
  });
  if (!firstPrompt) return;
  if (status === 'success') {
    useChatStore.getState().setSetup(id, null);
    await sendChat(id, firstPrompt);
  } else {
    useChatStore.getState().setSetup(id, { text: firstPrompt, status: 'failed' });
  }
}

export async function sendHeldPrompt(id: string): Promise<void> {
  const held = useChatStore.getState().setup[id];
  if (!held) return;
  useChatStore.getState().setSetup(id, null);
  await sendChat(id, held.text);
}

export async function sendChat(
  id: string,
  text: string,
  attachments: ChatAttachment[] = [],
  delivery: ChatDelivery = 'auto',
  typed = false,
): Promise<boolean> {
  try {
    await window.api.chat.prompt(id, { text, attachments, typed }, delivery);
    return true;
  } catch (error) {
    useProjectStore.getState().addToast(String(error instanceof Error ? error.message : error), 'error');
    return false;
  }
}

/** The task description as a first message: attachments become the paths the agent can open. */
export function taskFirstPrompt(task: TaskWithWorkspace | null | undefined): string | undefined {
  return task?.prompt ? descriptionToHookPrompt(task.prompt) : undefined;
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function waitFor(predicate: () => boolean): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve) => {
    const stopChat = useChatStore.subscribe(check);
    const stopTerminal = useTerminalStore.subscribe(check);
    function check() {
      if (!predicate()) return;
      stopChat();
      stopTerminal();
      resolve();
    }
  });
}

function chatBusy(id: string): boolean {
  const status = useChatStore.getState().sessions[id]?.info.status;
  return status === 'running' || status === 'awaiting';
}

/**
 * Hand the card's conversation to the agent's terminal UI. A running turn
 * finishes first — switching mid-turn would kill the agent partway through a
 * tool call — unless `interrupt` asks for it to stop now. The chat's agent
 * takes a moment to exit and writes nothing more once idle, so the terminal
 * starts without waiting for it.
 */
export async function switchToTerminal(id: string, opts: { interrupt?: boolean } = {}): Promise<void> {
  const term = terminalInstances.get(id);
  if (!term || term.surface !== 'chat' || useTerminalStore.getState().displayStates[id]?.switching) return;
  term.pushDisplayState({ switching: 'terminal' });
  try {
    if (chatBusy(id)) {
      if (opts.interrupt) await window.api.chat.interrupt(id);
      await waitFor(() => !chatBusy(id) || !terminalInstances.has(id));
    }
    if (!terminalInstances.has(id)) return;
    const resume = await window.api.chat.terminalResume(id);
    if (!resume) {
      useProjectStore.getState().addToast('This agent has no terminal to switch to', 'error');
      return;
    }
    window.api.chat.stop(id).catch((error: unknown) => chatLog.warn('chat did not stop', { id, error: String(error) }));
    term.openTerminal();
    term.clearScreen();
    term.setSurface('terminal');
    const command = [resume.file, ...resume.args].map(shellQuote).join(' ');
    const env = term.worktreePath
      ? buildWorktreeStartEnv({
          hookType: 'continue',
          projectPath: term.projectPath,
          worktreeInfo: { path: term.worktreePath, branch: term.worktreeBranch ?? '', createdAt: '' },
          label: term.label,
          task: null,
        })
      : undefined;
    const spawned = await term.spawnPty({
      ptyId: id,
      cwd: term.worktreePath ?? term.projectPath,
      projectPath: term.projectPath,
      command,
      cols: term.xterm.cols || 80,
      rows: term.xterm.rows || 24,
      label: term.label,
      taskId: term.taskId ?? undefined,
      worktreePath: term.worktreePath,
      env,
      sandboxProvider: term.sandboxProvider,
    });
    if (!spawned) {
      term.setSurface('chat');
      await window.api.chat.start(chatStartOptions(term));
    }
    requestAnimationFrame(() => term.focus());
  } finally {
    term.pushDisplayState({ switching: null });
  }
}

function chatStartOptions(term: OuijitTerminal) {
  return {
    id: term.ptyId,
    agent: term.chatAgent ?? 'claude',
    projectPath: term.projectPath,
    cwd: term.worktreePath ?? term.projectPath,
    taskId: term.taskId,
    worktreePath: term.worktreePath,
    sandboxProvider: term.sandboxProvider,
  } as const;
}

/**
 * Bring the conversation back into chat. The agent's terminal UI is stopped
 * once it is idle, and the chat resumes the same conversation, importing the
 * turns that happened in the terminal. The terminal UI takes a moment to exit
 * and leaves its session file as it was, so the chat starts without waiting.
 */
export async function switchToChat(id: string): Promise<void> {
  const term = terminalInstances.get(id);
  if (!term || term.surface !== 'terminal' || !term.chatAgent) return;
  if (useTerminalStore.getState().displayStates[id]?.switching) return;
  term.pushDisplayState({ switching: 'chat' });
  try {
    await waitFor(
      () => useTerminalStore.getState().displayStates[id]?.status !== 'thinking' || !terminalInstances.has(id),
    );
    if (!terminalInstances.has(id)) return;
    void term.releasePty();
    term.setSurface('chat');
    const snapshot = await window.api.chat.start({ ...chatStartOptions(term), eager: true });
    useChatStore.getState().adopt(snapshot);
    requestAnimationFrame(() => term.focus());
  } finally {
    term.pushDisplayState({ switching: null });
  }
}

/** Put the cards of chat sessions still running in the main process back, after a window reload. */
export async function reconnectChatSessions(projectPath?: string): Promise<void> {
  const live = await window.api.chat.listLive();
  for (const info of live) {
    if (isHomeChatId(info.id)) continue;
    if (projectPath && info.projectPath !== projectPath) continue;
    if (terminalInstances.has(info.id)) continue;
    const ok = await addChatCard(info.projectPath, {
      id: info.id,
      agent: info.agent,
      taskId: info.taskId ?? undefined,
      worktree: info.worktreePath ? { path: info.worktreePath, branch: '' } : undefined,
      sandboxProvider: (info.sandbox as SandboxProviderId | null) ?? undefined,
      background: true,
    });
    if (!ok) chatLog.warn('could not reconnect chat card', { id: info.id });
  }
}
