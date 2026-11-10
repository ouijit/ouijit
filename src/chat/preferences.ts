import { isChatAgentId, type ChatAgentId } from './model';
import { isSandboxProviderId, type SandboxProviderId } from '../sandbox/types';

export const CHAT_AGENT_LABELS: Record<ChatAgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
  opencode: 'opencode',
  acp: 'ACP agent',
};

/** globalSettings keys for the app-level chat preferences. Leaf module, shared by main and renderer. */
export const CHAT_SETTING_KEYS = {
  surface: 'chat:surface',
  agent: 'chat:agent',
  piApprovals: 'chat:piApprovals',
  acpCommand: 'chat:acpCommand',
} as const;

export type TaskSurface = 'terminal' | 'chat';

export interface ChatSettings {
  /** What a task opens in. */
  surface: TaskSurface;
  agent: ChatAgentId;
  piApprovals: boolean;
  acpCommand: string;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  surface: 'terminal',
  agent: 'claude',
  piApprovals: false,
  acpCommand: '',
};

export function parseChatSettings(read: (key: string) => string | undefined | null): ChatSettings {
  const surface = read(CHAT_SETTING_KEYS.surface);
  const agent = read(CHAT_SETTING_KEYS.agent);
  return {
    surface: surface === 'chat' ? 'chat' : 'terminal',
    agent: isChatAgentId(agent) ? agent : DEFAULT_CHAT_SETTINGS.agent,
    piApprovals: read(CHAT_SETTING_KEYS.piApprovals) === '1',
    acpCommand: read(CHAT_SETTING_KEYS.acpCommand) ?? '',
  };
}

/** The app-wide chat's session id: one conversation, under one card id, across every project. */
export const HOME_CHAT_ID = 'chat';

export const HOME_CHAT_SETTING_KEYS = {
  agent: 'homeChat:agent',
  sandbox: 'homeChat:sandbox',
  instructions: 'homeChat:instructions',
  wake: 'homeChat:wake',
} as const;

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
  sandbox: 'nono',
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
