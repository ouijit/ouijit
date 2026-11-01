import type {
  ChatAgentId,
  ChatAnswer,
  ChatAttachment,
  ChatCapabilities,
  ChatNode,
  ChatSessionInfo,
  ChatTextField,
  RequestNode,
} from './model';
import type { AgentProcess, AgentSpawn } from './process';

export interface UserInput {
  /** The transcript node this message is, so an agent that keys messages by id can rewind to it. */
  id: string;
  text: string;
  attachments: ChatAttachment[];
}

export interface DriverContext {
  cwd: string;
  sessionId: string;
  /** The agent conversation to resume — or to branch a new one from, with `fork` — or null for a new one. */
  resume: { agentSessionId: string; fork: boolean } | null;
  spawn: (spawn: AgentSpawn) => Promise<AgentProcess>;
  sink: DriverSink;
  /** The Ouijit CLI reference this agent is told about: the sandbox's variant when it runs sandboxed. */
  instructions: string;
  preferences: ChatPreferences;
}

export interface ChatPreferences {
  /** Load Ouijit's gate into pi, which otherwise runs every tool call without asking. */
  piApprovals: boolean;
  /** The ACP agent to run for the `acp` driver, as a command line. */
  acpCommand: string;
}

/**
 * How a driver reports. Node ids are the driver's to choose and must be stable
 * across a resume where the agent's history gives it ids, so an import does not
 * duplicate what the transcript already holds.
 */
export interface DriverSink {
  node(node: ChatNode): void;
  append(id: string, field: ChatTextField, delta: string): void;
  remove(ids: string[]): void;
  session(patch: Partial<ChatSessionInfo>): void;
  /** Block on a person. Resolves with the first client's answer, or `cancel` if the session ends first. */
  ask(request: Omit<RequestNode, 'kind' | 'status' | 'answer' | 'createdAt'>): Promise<ChatAnswer>;
  /** The agent's history, for a resume: replaces the transcript. An empty history is ignored. */
  history(nodes: ChatNode[]): void;
  /** The agent dropped its conversation and started another: the transcript starts over too. */
  reset(): void;
  log(message: string, data?: Record<string, unknown>): void;
}

export interface DriverSession {
  readonly capabilities: ChatCapabilities;
  prompt(input: UserInput): Promise<void>;
  /** Deliver mid-turn. Only called where `steer` or `queue` is supported. */
  send(input: UserInput, delivery: 'steer' | 'queue'): Promise<void>;
  interrupt(): Promise<void>;
  setModel?(model: string): Promise<void>;
  setEffort?(effort: string): Promise<void>;
  setMode?(mode: string): Promise<void>;
  /** Undo back to before a user message: the conversation, and the agent's edits where it tracks them. */
  rewind?(userMessageId: string): Promise<void>;
  compact?(): Promise<void>;
  /**
   * Start a fresh conversation, for an agent whose protocol does not take
   * `/clear` as a message. The driver calls `reset` once it has.
   */
  clear?(): Promise<void>;
  /** Stop the agent process. Safe to call twice. */
  close(): Promise<void>;
}

export interface TerminalResume {
  file: string;
  args: string[];
}

export interface DriverProbe {
  installed: boolean;
  version?: string;
  /** Why chat cannot run with what is installed, in words a person can act on. */
  problem?: string;
}

export interface AgentDriver {
  readonly id: ChatAgentId;
  readonly label: string;
  probe(): Promise<DriverProbe>;
  start(context: DriverContext): Promise<DriverSession>;
  /**
   * The agent's own terminal UI resuming a conversation, so a card can switch
   * to the terminal mid-task. Null where the agent has no such command.
   */
  terminalResume(agentSessionId: string | null): TerminalResume | null;
}
