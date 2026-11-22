import { isChatAgentId, type ChatAgentId } from './model';
import { isSandboxProviderId, type SandboxProviderId } from '../sandbox/types';
import { DEFAULT_HOME_CHAT_INSTRUCTIONS } from './homeChatInstructions';

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
  piApprovals: 'chat:piApprovals',
  acpCommand: 'chat:acpCommand',
} as const;

export type TaskSurface = 'terminal' | 'chat';

export interface ChatSettings {
  /** Experimental, off by default: Chat itself, and tasks opening as a chat. */
  enabled: boolean;
  piApprovals: boolean;
  acpCommand: string;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enabled: false,
  piApprovals: false,
  acpCommand: '',
};

export function parseChatSettings(read: (key: string) => string | undefined | null): ChatSettings {
  return {
    enabled: read(CHAT_SETTING_KEYS.enabled) === '1',
    piApprovals: read(CHAT_SETTING_KEYS.piApprovals) === '1',
    acpCommand: read(CHAT_SETTING_KEYS.acpCommand) ?? '',
  };
}

/**
 * How a project's tasks open: in a terminal, where the start hook runs, or as
 * a chat, which runs Setup first and then sends the first message.
 */
export interface TaskOpening {
  surface: TaskSurface;
  agent: ChatAgentId;
  setup: string;
  firstMessage: string;
}

export const DEFAULT_TASK_OPENING: TaskOpening = {
  surface: 'terminal',
  agent: 'claude',
  setup: '',
  firstMessage: '$OUIJIT_TASK_DESCRIPTION',
};

/** globalSettings key holding a project's TaskOpening, as JSON. */
export function taskOpeningKey(projectPath: string): string {
  return `chat:taskStart:${projectPath}`;
}

export function parseTaskOpening(raw: string | null | undefined): TaskOpening {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    // A value that will not parse reads as nothing stored.
  }
  const text = (key: 'setup' | 'firstMessage') => {
    const value = stored[key];
    return typeof value === 'string' ? value : DEFAULT_TASK_OPENING[key];
  };
  return {
    surface: stored.surface === 'chat' ? 'chat' : 'terminal',
    agent: isChatAgentId(stored.agent) ? stored.agent : DEFAULT_TASK_OPENING.agent,
    setup: text('setup'),
    firstMessage: text('firstMessage'),
  };
}

/** Readable in logs and the database; what makes a session one of Chat's is its role, not this. */
export const HOME_CHAT_ID_PREFIX = 'home-';

export const HOME_CHAT_SETTING_KEYS = {
  agent: 'homeChat:agent',
  sandbox: 'homeChat:sandbox',
  instructions: 'homeChat:userInstructions',
  wake: 'homeChat:wake',
  current: 'homeChat:current',
} as const;

/** The panels open beside one of Chat's conversations, as the window last left them. */
export function homeChatPanelsKey(id: string): string {
  return `homeChat:panels:${id}`;
}

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
  /** When its last turn began, or it started if none has: what the list is ordered by. */
  activeAt: number;
  /** In a turn, or with work it left running in the background. */
  working: boolean;
}

/** A task, as news about it is routed: to the conversation that started it. */
export interface TaskRef {
  projectPath: string;
  taskNumber: number;
}

export interface HomeChatState {
  currentId: string;
  chats: HomeChatSummary[];
  /** The conversation that started each task, by `taskKey`. */
  owners: Record<string, string>;
  /** The tasks each conversation follows, by conversation id. */
  following: Record<string, TaskRef[]>;
}

export const taskKey = (projectPath: string, taskNumber: number) => `${projectPath}#${taskNumber}`;

/** The task a `taskKey` names; null for anything else followed, such as a chat with no task. */
export function taskOfKey(key: string): TaskRef | null {
  const at = key.lastIndexOf('#');
  const taskNumber = at === -1 ? NaN : Number(key.slice(at + 1));
  return Number.isInteger(taskNumber) ? { projectPath: key.slice(0, at), taskNumber } : null;
}

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
  instructions: DEFAULT_HOME_CHAT_INSTRUCTIONS,
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
    instructions: read(HOME_CHAT_SETTING_KEYS.instructions) ?? DEFAULT_HOME_CHAT_INSTRUCTIONS,
    wake,
  };
}
