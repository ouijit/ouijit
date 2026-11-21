/**
 * What drivers translate an agent's protocol into; nothing outside a driver
 * sees an agent's wire format.
 *
 * Leaf module: no imports, so a renderer can share it.
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
  /** When it stopped running, stamped by the host as it sees that happen. */
  endedAt?: number;
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
  /** When it stopped running, stamped by the host as it sees that happen. */
  endedAt?: number;
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
  /** Set where the notice is a background task ending: which, how, and after how long. */
  ended?: { taskId: string; status: 'completed' | 'failed' | 'stopped'; ms: number };
}

/** Where the user stopped a turn: the same quiet line for every agent. */
export function stoppedNode(id: string): NoticeNode {
  return { id, kind: 'notice', level: 'info', parentId: null, createdAt: Date.now(), text: 'Stopped' };
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
  /** For an alias such as Claude's Default: the label of the option it currently stands for. */
  standsFor?: string;
  /** For a mode: how much the agent does without asking, higher doing more. */
  latitude?: number;
}

export interface ChatCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

export type ChatSessionStatus = 'starting' | 'idle' | 'running' | 'awaiting' | 'exited' | 'error';

/** What a driver reports about its session. */
export interface ChatSessionInfo {
  agent: ChatAgentId;
  /** The agent's own id for this conversation, used to resume it in chat or terminal. */
  agentSessionId: string | null;
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
  modes: ChatOption[];
  commands: ChatCommand[];
  /** How much of the model's window the conversation fills, as of the agent's last request. */
  usage?: { contextTokens: number; contextWindow?: number };
  /** Work the agent left running between turns. Only agents that report it set this. */
  background?: ChatBackgroundTask[];
}

export interface ChatBackgroundTask {
  id: string;
  kind: 'shell' | 'agent';
  description: string;
  /** When the agent started it, or when the client first saw it running. */
  startedAt: number;
  /** The tool call that sent it to the background. */
  toolCallId?: string;
}

export type ChatTextField = 'text' | 'output';
