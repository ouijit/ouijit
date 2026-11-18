import type { ChatAgentId, ChatRole } from './model';
import type { SandboxProviderId } from '../sandbox/types';

export interface ChatStartOptions {
  /** The card's id. A stored session under it resumes; otherwise a new one starts under it. */
  id?: string;
  agent: ChatAgentId;
  projectPath: string;
  cwd: string;
  taskId: number | null;
  worktreePath?: string;
  sandboxProvider?: SandboxProviderId;
  label?: string;
  /** Start from an agent conversation that began outside this session, e.g. in the card's terminal. */
  resume?: { agentSessionId: string; fork: boolean };
  /** Return once the session exists, while the agent is still launching; the launch arrives as events. */
  eager?: boolean;
  /** Appended to the CLI reference the agent is given. */
  instructions?: string;
  /** Fixed when the session is first created; a start that names another role for a stored one fails. */
  role?: ChatRole;
  /** The mode the agent starts in on every launch, over one picked in the chat. */
  mode?: string;
  /**
   * Apply `agent` and `sandboxProvider` over a stored session's. The agent
   * starts a conversation of its own; Ouijit's transcript carries on.
   */
  reconfigure?: boolean;
}

export type ChatDelivery = 'auto' | 'steer' | 'queue';
