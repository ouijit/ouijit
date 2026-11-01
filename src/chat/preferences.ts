import { isChatAgentId, type ChatAgentId } from './model';

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
