import { isChatAgentId, type ChatAgentId } from './model';
import { isSandboxProviderId, type SandboxProviderId } from '../sandbox/types';
import type { AskRun } from '../ask';

export const CHAT_AGENT_LABELS: Record<ChatAgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  opencode: 'opencode',
  acp: 'ACP agent',
};

/** globalSettings keys for the app-level chat preferences. Leaf module, shared by main and renderer. */
export const CHAT_SETTING_KEYS = {
  enabled: 'chat:enabled',
  surface: 'chat:surface',
  agent: 'chat:agent',
  piApprovals: 'chat:piApprovals',
  acpCommand: 'chat:acpCommand',
} as const;

export type TaskSurface = 'terminal' | 'chat';

export interface ChatSettings {
  /** Experimental, off by default: Chat itself, and tasks opening as a chat. */
  enabled: boolean;
  /** What a task opens in. */
  surface: TaskSurface;
  agent: ChatAgentId;
  piApprovals: boolean;
  acpCommand: string;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enabled: false,
  surface: 'terminal',
  agent: 'claude',
  piApprovals: false,
  acpCommand: '',
};

export function parseChatSettings(read: (key: string) => string | undefined | null): ChatSettings {
  const enabled = read(CHAT_SETTING_KEYS.enabled) === '1';
  const surface = read(CHAT_SETTING_KEYS.surface);
  const agent = read(CHAT_SETTING_KEYS.agent);
  return {
    enabled,
    // With chat off, every task opens as a terminal whatever was chosen while it was on.
    surface: enabled && surface === 'chat' ? 'chat' : 'terminal',
    agent: isChatAgentId(agent) ? agent : DEFAULT_CHAT_SETTINGS.agent,
    piApprovals: read(CHAT_SETTING_KEYS.piApprovals) === '1',
    acpCommand: read(CHAT_SETTING_KEYS.acpCommand) ?? '',
  };
}

/** Readable in logs and the database; what makes a session one of Chat's is its role, not this. */
export const HOME_CHAT_ID_PREFIX = 'home-';

export const HOME_CHAT_SETTING_KEYS = {
  agent: 'homeChat:agent',
  sandbox: 'homeChat:sandbox',
  instructions: 'homeChat:instructions',
  wake: 'homeChat:wake',
  current: 'homeChat:current',
} as const;

export const UNTITLED_HOME_CHAT = 'New chat';

/** A conversation's title, until renamed: the start of what it was asked first. */
export function titleFromMessage(text: string): string {
  const line = text
    .split('\n')
    .map((l) => l.replace(/^[\s#>*`-]+/, '').trim())
    .find(Boolean);
  if (!line) return UNTITLED_HOME_CHAT;
  const flat = line.replace(/\s+/g, ' ').replace(/[`*_]/g, '');
  if (flat.length <= 42) return flat;
  const cut = flat.slice(0, 42);
  const at = cut.lastIndexOf(' ');
  return `${(at > 20 ? cut.slice(0, at) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export interface HomeChatSummary {
  id: string;
  title: string;
  createdAt: string;
}

/**
 * A command Chat asks the user to run outside its sandbox. Held in the main
 * process, so it survives a reload and any window can answer it.
 */
export type ChatDecision = {
  id: string;
  /** The conversation that asked. */
  from: string;
  at: number;
} & { kind: 'ask'; ask: AskRun; message?: string; sandboxed?: boolean };

/** A task, as news about it is routed: to the conversation that started it. */
export interface TaskRef {
  projectPath: string;
  taskNumber: number;
}

export type ChatDecisionChoice = { kind: 'run'; privately?: boolean } | { kind: 'decline' };

export interface HomeChatState {
  currentId: string;
  chats: HomeChatSummary[];
  /** The conversation that started each task, by `taskKey`. */
  owners: Record<string, string>;
}

export const taskKey = (projectPath: string, taskNumber: number) => `${projectPath}#${taskNumber}`;

export const WAKE_EVENTS = ['turnEnded', 'asked', 'taskMoved', 'hookFailed'] as const;
export type WakeEvent = (typeof WAKE_EVENTS)[number];

export const WAKE_EVENT_LABELS: Record<WakeEvent, string> = {
  turnEnded: 'A worker finishes a turn',
  asked: 'A worker waits on an approval',
  taskMoved: 'A task changes column',
  hookFailed: 'A hook fails',
};

export interface HomeChatSettings {
  agent: ChatAgentId;
  sandbox: SandboxProviderId;
  instructions: string;
  /** What arrives in the chat as a message without the user asking. */
  wake: Record<WakeEvent, boolean>;
}

export const DEFAULT_HOME_CHAT_SETTINGS: HomeChatSettings = {
  agent: 'claude',
  sandbox: 'none',
  instructions: '',
  wake: { turnEnded: true, asked: true, taskMoved: true, hookFailed: true },
};

export function parseHomeChatSettings(read: (key: string) => string | undefined | null): HomeChatSettings {
  const agent = read(HOME_CHAT_SETTING_KEYS.agent);
  const sandbox = read(HOME_CHAT_SETTING_KEYS.sandbox);
  const wake = { ...DEFAULT_HOME_CHAT_SETTINGS.wake };
  const storedWake = read(HOME_CHAT_SETTING_KEYS.wake);
  if (storedWake) {
    try {
      const parsed = JSON.parse(storedWake) as Partial<Record<WakeEvent, unknown>>;
      for (const event of WAKE_EVENTS) if (typeof parsed[event] === 'boolean') wake[event] = parsed[event];
    } catch {
      /* the defaults */
    }
  }
  return {
    agent: isChatAgentId(agent) ? agent : DEFAULT_HOME_CHAT_SETTINGS.agent,
    sandbox: isSandboxProviderId(sandbox) ? sandbox : DEFAULT_HOME_CHAT_SETTINGS.sandbox,
    instructions: read(HOME_CHAT_SETTING_KEYS.instructions) ?? '',
    wake,
  };
}
