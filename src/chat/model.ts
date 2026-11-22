/**
 * The chat model every client renders: the agents' model, plus what Ouijit
 * adds to it.
 *
 * Events patch nodes by id, so a client that joins late takes a snapshot and
 * applies only the events after its sequence number.
 *
 * Imports only the agents' leaf model, so the renderer and the CLI can share it.
 */

import type {
  ChatAgentId,
  ChatCommand,
  ChatNode as AgentChatNode,
  ChatSessionInfo as AgentSessionInfo,
  ChatTextField,
  RequestNode as AgentRequestNode,
  UserMessageNode as AgentUserMessageNode,
} from '../agents/model';

export {
  CHAT_AGENT_IDS,
  NO_CAPABILITIES,
  isChatAgentId,
  stoppedNode,
  type AssistantMessageNode,
  type ChatAgentId,
  type ChatAnswer,
  type ChatAttachment,
  type ChatBackgroundTask,
  type ChatCapabilities,
  type ChatCommand,
  type ChatNodeKind,
  type ChatOption,
  type ChatSessionStatus,
  type ChatTextField,
  type CompactionNode,
  type FileChange,
  type NodeStatus,
  type NoticeNode,
  type PlanEntry,
  type PlanNode,
  type ReasoningNode,
  type RequestOption,
  type RequestOptionKind,
  type RequestQuestion,
  type SubagentNode,
  type ToolCallNode,
  type ToolKind,
} from '../agents/model';

export interface UserMessageNode extends AgentUserMessageNode {
  /** Sent by Ouijit about something that happened, not typed by a person. */
  wake?: boolean;
  /** What a wake is about, in a line each for the person reading the transcript; its text is for the agent. */
  notes?: WakeNote[];
}

/** `decision` is something the user did; `event` is something that happened. */
export interface WakeNote {
  kind: 'event' | 'decision';
  text: string;
  /** A command the decision was about, shown behind the line rather than in it. */
  command?: string;
  /** How it went, beside the line: Declined, Ran, Exit 1. */
  outcome?: string;
  /** A worker's request the wake is about, kept current as it is answered. */
  request?: WakeRequest;
}

export interface WakeRequest {
  /** The worker's chat, where the request is answered. */
  session: string;
  /** The worker as the reader knows it, with its task's number. */
  name: string;
  node: RequestNode;
  /** The command it would run, where the request is to run one. */
  command?: string;
  /** What the agent said that command does, where it said. */
  step?: string;
}

export interface RequestNode extends AgentRequestNode {
  /** Answered by Chat rather than a person. */
  byChat?: boolean;
}

export type ChatNode = Exclude<AgentChatNode, AgentUserMessageNode | AgentRequestNode> | UserMessageNode | RequestNode;

/** A card's own chat, or one of Chat's conversations, which the API grants Chat's reach. */
export type ChatRole = 'card' | 'home';

/** A task's chat as its menu lists it, to open again. */
export interface TaskChatSummary {
  id: string;
  taskId: number;
  agent: ChatAgentId;
  sandbox: string | null;
  /** What the user first asked, which is what tells one of a task's chats from another. */
  firstMessage: string;
  updatedAt: string;
}

export interface ChatSessionInfo extends AgentSessionInfo {
  id: string;
  /** Set by the host when the session is created, from its stored row; never by a client. */
  role: ChatRole;
  /** The card's name, for listings outside the window. */
  label?: string;
  projectPath: string;
  cwd: string;
  worktreePath: string | null;
  /** The sandbox backend the agent runs in, or null on the host. */
  sandbox: string | null;
  taskId: number | null;
  /** A mode picked during a turn, applied once the turn ends. */
  pendingMode?: string | null;
  /** Asked to stop and not yet stopped: the turn is over as far as anyone watching is concerned. */
  stopping?: boolean;
  /** When a compaction asked for from chat began, until it ends. */
  compacting?: number | null;
}

export type ChatEvent =
  | { type: 'node'; node: ChatNode }
  | { type: 'append'; id: string; field: ChatTextField; delta: string }
  | { type: 'remove'; ids: string[] }
  | { type: 'session'; patch: Partial<ChatSessionInfo> };

export interface SequencedChatEvent {
  seq: number;
  event: ChatEvent;
}

export interface ChatSnapshot {
  info: ChatSessionInfo;
  nodes: ChatNode[];
  /** The last event folded into this snapshot. Apply only events after it. */
  seq: number;
}

/** Apply one event to a snapshot's nodes in place. */
export function applyChatEvent(state: { info: ChatSessionInfo; nodes: ChatNode[] }, event: ChatEvent): void {
  switch (event.type) {
    case 'node': {
      const index = state.nodes.findIndex((node) => node.id === event.node.id);
      if (index === -1) state.nodes.push(event.node);
      else state.nodes[index] = event.node;
      return;
    }
    case 'append': {
      const index = state.nodes.findIndex((node) => node.id === event.id);
      if (index === -1) return;
      const node = state.nodes[index] as ChatNode & Partial<Record<ChatTextField, string>>;
      const current = node[event.field];
      if (typeof current !== 'string') return;
      state.nodes[index] = { ...node, [event.field]: current + event.delta } as ChatNode;
      return;
    }
    case 'remove': {
      const ids = new Set(event.ids);
      state.nodes = state.nodes.filter((node) => !ids.has(node.id));
      return;
    }
    case 'session':
      state.info = { ...state.info, ...event.patch };
      return;
  }
}

export function pendingRequests(nodes: ChatNode[]): RequestNode[] {
  return nodes.filter((node): node is RequestNode => node.kind === 'request' && node.status === 'pending');
}

export function transcriptText(nodes: ChatNode[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'user_message':
        lines.push(`> ${node.text}`);
        break;
      case 'assistant_message':
        if (node.text) lines.push(node.text);
        break;
      case 'tool_call':
        lines.push(`[${node.status}] ${node.title}`);
        break;
      case 'plan':
        for (const entry of node.entries) lines.push(`- [${entry.status === 'completed' ? 'x' : ' '}] ${entry.text}`);
        break;
      case 'request':
        lines.push(`? ${node.title}${node.status === 'pending' ? ' (waiting)' : ''}`);
        break;
      case 'notice':
        lines.push(`! ${node.text}`);
        break;
      case 'subagent':
        lines.push(`[subagent] ${node.title}`);
        break;
      case 'reasoning':
      case 'compaction':
        break;
    }
  }
  return lines.join('\n\n');
}

/** Commands Ouijit runs itself for every agent, through the chat's own controls. */
export type ConversationAction = 'clear' | 'compact' | 'model' | 'effort';

const CONVERSATION_COMMANDS: Record<string, ConversationAction> = {
  clear: 'clear',
  new: 'clear',
  reset: 'clear',
  compact: 'compact',
  model: 'model',
  effort: 'effort',
};

export function isConversationCommand(name: string): boolean {
  return name in CONVERSATION_COMMANDS;
}

/**
 * Commands each agent has only in its own terminal UI, which a chat cannot
 * run. Anything else that starts with a slash and is not in the chat's menu
 * is just a message.
 */
/** The command that starts an agent's own terminal UI, for what only that UI does. */
export const AGENT_TERMINAL_COMMANDS: Partial<Record<ChatAgentId, string>> = {
  claude: 'claude',
  codex: 'codex',
  pi: 'pi',
  opencode: 'opencode',
};

const TERMINAL_ONLY_COMMANDS: Partial<Record<ChatAgentId, string[]>> = {
  claude: [
    'login',
    'logout',
    'config',
    'doctor',
    'terminal-setup',
    'vim',
    'ide',
    'permissions',
    'status',
    'statusline',
    'memory',
    'resume',
    'export',
    'theme',
    'mcp',
    'agents',
    'hooks',
    'bug',
    'upgrade',
    'usage',
    'cost',
    'add-dir',
    'privacy-settings',
    'release-notes',
    'exit',
  ],
  codex: ['login', 'logout', 'status', 'approvals', 'diff', 'mention', 'resume', 'quit', 'exit'],
  pi: ['login', 'logout', 'settings', 'hotkeys', 'resume', 'session', 'tree', 'export', 'share', 'quit'],
  opencode: ['themes', 'editor', 'sessions', 'share', 'unshare', 'exit'],
};

export type SlashCommand =
  | { kind: 'conversation'; action: ConversationAction; name: string; argument: string }
  | { kind: 'agent'; name: string }
  | { kind: 'terminal'; name: string };

/**
 * What a typed slash command is in a chat: one Ouijit runs itself, one the
 * agent runs, or one that only exists in the agent's terminal UI. Null for
 * anything else, which is sent as a message: a path (`/Users/...`), or a
 * sentence that happens to start with a slash.
 */
export function parseSlashCommand(text: string, commands: ChatCommand[], agent: ChatAgentId): SlashCommand | null {
  const match = /^\/([A-Za-z][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1];
  const action = CONVERSATION_COMMANDS[name];
  if (action) return { kind: 'conversation', action, name, argument: (match[2] ?? '').trim() };
  if (commands.some((command) => command.name === name)) return { kind: 'agent', name };
  return TERMINAL_ONLY_COMMANDS[agent]?.includes(name) ? { kind: 'terminal', name } : null;
}

/**
 * Whether the agent is still at work: in a turn, or with work it left
 * running in the background. Only once both are over has it finished.
 */
export function stillWorking(info: Pick<ChatSessionInfo, 'status' | 'background'>): boolean {
  return info.status === 'running' || (info.background?.length ?? 0) > 0;
}
