/**
 * The chat model every client renders. Drivers translate an agent's protocol
 * into it; nothing outside a driver sees an agent's wire format.
 *
 * Events patch nodes by id, so a client that joins late takes a snapshot and
 * applies only the events after its sequence number.
 *
 * Leaf module: no imports, so the renderer and the CLI can share it.
 */

export type ChatAgentId = 'claude' | 'codex' | 'pi' | 'opencode' | 'acp';

export const CHAT_AGENT_IDS: readonly ChatAgentId[] = ['claude', 'codex', 'pi', 'opencode', 'acp'];

export function isChatAgentId(value: unknown): value is ChatAgentId {
  return typeof value === 'string' && (CHAT_AGENT_IDS as readonly string[]).includes(value);
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'declined' | 'interrupted';

interface NodeBase {
  id: string;
  /** The subagent node this one ran inside, or null at the top level. */
  parentId: string | null;
  createdAt: number;
}

export interface ChatAttachment {
  /** Absolute path on the machine the agent runs on. */
  path: string;
  name: string;
  mimeType: string;
}

export interface UserMessageNode extends NodeBase {
  kind: 'user_message';
  text: string;
  attachments: ChatAttachment[];
  /** `queued` waits for the turn to end; `steer` was folded into the running one. */
  delivery: 'prompt' | 'steer' | 'queued';
  /** Sent by Ouijit about something that happened, not typed by a person. */
  wake?: boolean;
}

export interface AssistantMessageNode extends NodeBase {
  kind: 'assistant_message';
  text: string;
  status: NodeStatus;
}

export interface ReasoningNode extends NodeBase {
  kind: 'reasoning';
  text: string;
  status: NodeStatus;
}

export type ToolKind = 'command' | 'edit' | 'read' | 'search' | 'fetch' | 'mcp' | 'subagent' | 'other';

export interface FileChange {
  path: string;
  change: 'add' | 'delete' | 'modify' | 'move';
  movedFrom?: string;
  /** Unified diff of this file, where the agent reports one. */
  diff?: string;
}

export interface ToolCallNode extends NodeBase {
  kind: 'tool_call';
  tool: ToolKind;
  /** The agent's own tool name: `Bash`, `apply_patch`, `mcp__linear__get_issue`. */
  name: string;
  title: string;
  /** Structured input as the agent sent it, for a detail view. */
  input: unknown;
  command?: string;
  cwd?: string;
  output: string;
  exitCode?: number;
  files: FileChange[];
  status: NodeStatus;
}

export interface PlanEntry {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanNode extends NodeBase {
  kind: 'plan';
  entries: PlanEntry[];
  /** A proposed plan awaiting approval (plan mode) rather than a running todo list. */
  proposal?: string;
}

export interface SubagentNode extends NodeBase {
  kind: 'subagent';
  title: string;
  agentType?: string;
  status: NodeStatus;
}

export interface NoticeNode extends NodeBase {
  kind: 'notice';
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface CompactionNode extends NodeBase {
  kind: 'compaction';
  trigger: 'manual' | 'auto';
}

export type RequestOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | 'other';

export interface RequestOption {
  id: string;
  label: string;
  kind: RequestOptionKind;
}

export interface RequestQuestion {
  id: string;
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect: boolean;
  /** Free text is accepted alongside, or instead of, the options. */
  allowText: boolean;
}

/**
 * Something the agent is blocked on until a person answers it: an approval
 * (pick an option), or questions (answer each). Any client may answer; the
 * first answer wins and the rest see it resolved.
 */
export interface RequestNode extends NodeBase {
  kind: 'request';
  request: 'approval' | 'questions';
  title: string;
  detail?: string;
  /** The tool call this approval gates. */
  toolCallId?: string;
  options: RequestOption[];
  questions: RequestQuestion[];
  status: 'pending' | 'answered' | 'cancelled';
  answer?: ChatAnswer;
}

export type ChatNode =
  | UserMessageNode
  | AssistantMessageNode
  | ReasoningNode
  | ToolCallNode
  | PlanNode
  | SubagentNode
  | NoticeNode
  | CompactionNode
  | RequestNode;

export type ChatNodeKind = ChatNode['kind'];

export type ChatAnswer =
  | { kind: 'option'; optionId: string; message?: string }
  | { kind: 'answers'; answers: Record<string, string[]> }
  | { kind: 'cancel' };

/** What a driver supports. A client shows a control only where its capability is true. */
export interface ChatCapabilities {
  images: boolean;
  /** A message sent mid-turn joins the running turn. */
  steer: boolean;
  /** A message sent mid-turn waits for the turn to end. */
  queue: boolean;
  interrupt: boolean;
  models: boolean;
  effort: boolean;
  modes: boolean;
  commands: boolean;
  fork: boolean;
  /** Undo the conversation, and the agent's file edits, back to a message. */
  rewind: boolean;
  compact: boolean;
}

export const NO_CAPABILITIES: ChatCapabilities = {
  images: false,
  steer: false,
  queue: false,
  interrupt: false,
  models: false,
  effort: false,
  modes: false,
  commands: false,
  fork: false,
  rewind: false,
  compact: false,
};

export interface ChatOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChatCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

export type ChatSessionStatus = 'starting' | 'idle' | 'running' | 'awaiting' | 'exited' | 'error';

export interface ChatSessionInfo {
  id: string;
  /** The card's name, for listings outside the window. */
  label?: string;
  agent: ChatAgentId;
  /** The agent's own id for this conversation, used to resume it in chat or terminal. */
  agentSessionId: string | null;
  projectPath: string;
  cwd: string;
  worktreePath: string | null;
  /** The sandbox backend the agent runs in, or null on the host. */
  sandbox: string | null;
  taskId: number | null;
  status: ChatSessionStatus;
  /** Why the session is in `error` or `exited`, in the agent's words where it gave any. */
  statusDetail?: string;
  agentVersion?: string;
  capabilities: ChatCapabilities;
  model?: string;
  models: ChatOption[];
  effort?: string;
  efforts: ChatOption[];
  mode?: string;
  /** A mode picked during a turn, applied once the turn ends. */
  pendingMode?: string | null;
  modes: ChatOption[];
  commands: ChatCommand[];
  usage?: { inputTokens: number; outputTokens: number; contextWindow?: number };
  /** Work the agent left running between turns. Only agents that report it set this. */
  background?: ChatBackgroundTask[];
}

export interface ChatBackgroundTask {
  id: string;
  kind: 'shell' | 'agent';
  description: string;
}

export type ChatTextField = 'text' | 'output';

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

export type SlashCommand =
  | { kind: 'conversation'; action: ConversationAction; name: string; argument: string }
  | { kind: 'agent'; name: string }
  | { kind: 'terminal'; name: string };

/**
 * What a typed slash command is in a chat: one Ouijit runs itself, one the
 * agent runs, or one that only exists in the agent's terminal UI — anything
 * not in the chat's menu. Null for text that is not a command, a path
 * (`/Users/...`) included.
 */
export function parseSlashCommand(text: string, commands: ChatCommand[]): SlashCommand | null {
  const match = /^\/([A-Za-z][\w:.-]*)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return null;
  const name = match[1];
  const action = CONVERSATION_COMMANDS[name];
  if (action) return { kind: 'conversation', action, name, argument: (match[2] ?? '').trim() };
  if (commands.some((command) => command.name === name)) return { kind: 'agent', name };
  return { kind: 'terminal', name };
}
