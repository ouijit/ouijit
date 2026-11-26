import log from 'electron-log/renderer';
import { OuijitTerminal, resolveTerminalLabel } from '../terminal/terminalReact';
import { registerTerminal, spawnRunner, applyInitialUiState, addProjectTerminal } from '../terminal/terminalActions';
import { terminalInstances } from '../terminal/terminalRegistry';
import { useChatStore, listenForChatEvents, loadTaskChats } from '../../stores/chatStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useProjectStore } from '../../stores/projectStore';
import { generateId } from '../../utils/ids';
import { placementProvider, sameSandbox } from '../../sandbox/types';
import { loadChatSettings } from '../../services/chatSettings';
import { projectTaskOpening } from '../../stores/projectDataStore';
import { listenForHomeChat, useHomeChatStore } from '../../stores/homeChatStore';
import { useAppStore } from '../../stores/appStore';
import { startHomeChat } from './homeChatActions';
import { AGENT_TERMINAL_COMMANDS, stillWorking } from '../../chat/model';
import type { ChatAgentId, ChatAttachment, ChatSessionStatus, SequencedChatEvent } from '../../chat/model';
import type { SandboxPlacement, SnapshotTerminalUi, TaskWithWorkspace } from '../../types';
import type { ChatDelivery } from '../../chat/startOptions';

const chatLog = log.scope('chatActions');

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

/** A card reads as working until its turn and the work it left in the background have both ended. */
function forwardStatus(id: string, event: SequencedChatEvent): void {
  const { patch } = event.event.type === 'session' ? event.event : { patch: null };
  if (!patch || (!patch.status && !patch.background)) return;
  const info = useChatStore.getState().sessions[id]?.info;
  if (!info) return;
  const status = stillWorking(info) ? 'thinking' : cardStatus(info.status);
  const instance = terminalInstances.get(id);
  if (status && instance?.surface === 'chat') instance.setAgentStatus(status);
}

/** Start feeding chat events to the store and the cards. Call once at startup. */
export function initChat(): void {
  listenForChatEvents(forwardStatus);
  listenForHomeChat();
  void loadChatSettings().then(({ enabled }) => setChatEnabled(enabled));
}

/** Turn chat on or off for the app: Chat starts or stops, and its page and sidebar group come and go. */
export async function setChatEnabled(enabled: boolean): Promise<void> {
  useHomeChatStore.getState().setEnabled(enabled);
  if (enabled) {
    await startHomeChat();
    return;
  }
  if (useAppStore.getState().selection.kind === 'chat') useAppStore.getState().select({ kind: 'none' });
  const { currentId } = useHomeChatStore.getState();
  if (currentId) await window.api.chat.stop(currentId).catch(() => {});
}

export interface SetupCommand {
  name: string;
  command: string;
  hookType: 'start' | 'continue';
  sandbox?: SandboxPlacement;
}

export interface AddChatCardOptions {
  /** The card and session id. A stored session under it resumes. */
  id?: string;
  agent?: ChatAgentId;
  worktree?: { path: string; branch: string };
  taskId?: number;
  /** A stored session keeps its own. */
  sandbox?: SandboxPlacement;
  label?: string;
  background?: boolean;
  replaceLoadingId?: string;
  /** Run before the first prompt goes out, in a runner panel on the card. */
  setup?: SetupCommand;
  /** Sent as the first message. */
  firstPrompt?: string;
  /** Pick up the task's most recent chat rather than starting a new one. */
  resumeLatest?: boolean;
  initialUiState?: SnapshotTerminalUi;
}

/** Open a chat card. Resolves false when the agent could not be started at all. */
export async function addChatCard(projectPath: string, options: AddChatCardOptions = {}): Promise<boolean> {
  const opening = await projectTaskOpening(projectPath);
  let task: TaskWithWorkspace | null = null;
  if (options.taskId != null) task = await window.api.task.getByNumber(projectPath, options.taskId);

  let id = options.id;
  let agent = options.agent ?? opening.agent;
  const provider = placementProvider(options.sandbox);
  const sandbox = provider ? options.sandbox : undefined;
  if (!id && options.resumeLatest && options.taskId != null) {
    const latest = await window.api.chat.latestForTask(projectPath, options.taskId);
    // A conversation stays where it started, so another sandbox means a new one.
    const asked = typeof sandbox === 'object' ? sandbox : provider && { provider, settings: projectPath };
    if (latest && sameSandbox(latest.info.sandbox, asked)) {
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
    sandbox,
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
      sandboxProvider: provider,
      taskId: options.taskId ?? null,
      worktreeBranch: options.worktree?.branch ?? null,
      surface: 'chat',
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
      sandbox,
      label,
    });
  } catch (error) {
    chatLog.error('chat failed to start', { error: String(error) });
    useProjectStore.getState().addToast(`Chat failed to start: ${String(error)}`, 'error');
    return false;
  }
  useChatStore.getState().adopt(started);
  term.sandbox = started.info.sandbox ?? undefined;
  if (options.taskId != null) void loadTaskChats(projectPath);

  const firstPrompt = options.firstPrompt?.trim();
  if (options.setup?.command.trim()) {
    void runSetupThenPrompt(term, options.setup, firstPrompt);
  } else if (firstPrompt) {
    await sendChat(id, firstPrompt);
  }
  return true;
}

/**
 * Setup runs in a runner panel beside the chat, and the first prompt waits for
 * it to succeed.
 */
async function runSetupThenPrompt(
  term: OuijitTerminal,
  setup: SetupCommand,
  firstPrompt: string | undefined,
): Promise<void> {
  const id = term.ptyId;
  if (firstPrompt) useChatStore.getState().setSetup(id, { text: firstPrompt, status: 'running' });
  const panelId = term.addRunnerPanel(
    {
      name: setup.name,
      command: setup.command,
      source: 'hook',
      sandbox: setup.sandbox,
    },
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

/**
 * A terminal on the chat's task running its agent's own UI, for a command only
 * that UI has. It starts a conversation of its own; the chat's stays the chat's.
 */
export async function openAgentTerminal(id: string): Promise<void> {
  const term = terminalInstances.get(id);
  const command = term?.chatAgent ? AGENT_TERMINAL_COMMANDS[term.chatAgent] : undefined;
  if (!term || !command) return;
  await addProjectTerminal(
    term.projectPath,
    { name: command, command, source: 'custom', priority: 0 },
    {
      existingWorktree: term.worktreePath
        ? { path: term.worktreePath, branch: term.worktreeBranch ?? '', createdAt: '' }
        : undefined,
      taskId: term.taskId ?? undefined,
      sandbox: term.sandbox,
      label: term.label,
    },
  );
}

/** Put the cards of chat sessions still running in the main process back, after a window reload. */
export async function reconnectChatSessions(projectPath?: string): Promise<void> {
  const live = await window.api.chat.listLive();
  for (const info of live) {
    if (info.role === 'home') continue;
    if (projectPath && info.projectPath !== projectPath) continue;
    if (terminalInstances.has(info.id)) continue;
    const ok = await addChatCard(info.projectPath, {
      id: info.id,
      agent: info.agent,
      taskId: info.taskId ?? undefined,
      worktree: info.worktreePath ? { path: info.worktreePath, branch: '' } : undefined,
      sandbox: info.sandbox ?? undefined,
      ...(info.label && { label: info.label }),
      background: true,
    });
    if (!ok) chatLog.warn('could not reconnect chat card', { id: info.id });
  }
}
