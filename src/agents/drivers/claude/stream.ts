import type { PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { DriverSink } from '../../driver';
import type { ChatBackgroundTask, ChatSessionInfo, SubagentNode } from '../../model';
import { ClaudeTranscript, str, type Json } from './transcript';

/** What the stream learns about the conversation that starting, resuming and rewinding it depend on. */
export interface ClaudeConversation {
  sessionId: string | null;
  mode: PermissionMode | null;
  lastAssistantUuid: string | null;
  /** For a rewind: the last assistant message uuid before each user message we sent. */
  readonly before: Map<string, string | null>;
  /** The user stopped this turn, so it ending early is not an error. */
  stopping: boolean;
}

function contextOf(message: Json): { tokens: number; model: string | undefined } {
  const usage = (message.usage ?? {}) as Json;
  const tokens =
    Number(usage.input_tokens ?? 0) +
    Number(usage.cache_creation_input_tokens ?? 0) +
    Number(usage.cache_read_input_tokens ?? 0) +
    Number(usage.output_tokens ?? 0);
  return { tokens, model: str(message.model) };
}

export class ClaudeStream {
  private readonly transcript: ClaudeTranscript;
  private readonly messageIds = new Map<string | null, string>();
  /** Claude reports the model it resolved (`claude-opus-5-5`); the menu lists the aliases that resolve to them. */
  private readonly modelAliases = new Map<string, string>();
  /** A subagent outlives its Agent call when Claude runs it in the background, so it finishes on its own report. */
  private readonly subagents = new Map<string, SubagentNode>();
  /** Background shells, from when each started, for its time and the line that marks its end. */
  private readonly shells = new Map<string, Omit<ChatBackgroundTask, 'id' | 'kind'>>();
  private readonly agentsSeen = new Map<string, Omit<ChatBackgroundTask, 'id' | 'kind'>>();
  /** The list as Claude last reported it. */
  private backgroundTasks: Json[] = [];
  /**
   * Shells that were ever in that list. Claude starts and ends a task for
   * every shell, in the foreground too; only these were background work.
   */
  private readonly listed = new Set<string>();
  private reportedModel: string | undefined;
  private lastContext: { tokens: number; model: string | undefined } | null = null;

  constructor(
    private readonly sink: DriverSink,
    private readonly conversation: ClaudeConversation,
  ) {
    this.transcript = new ClaudeTranscript(sink);
  }

  /** Claude reports background work per process and says nothing at startup. */
  restarted(): void {
    this.backgroundTasks = [];
    this.sink.session({ background: [] });
  }

  modelPatch(models: { value: string; resolvedModel?: string }[] | null, reported?: string): { model?: string } {
    for (const model of models ?? []) {
      if (model.resolvedModel && !this.modelAliases.has(model.resolvedModel)) {
        this.modelAliases.set(model.resolvedModel, model.value);
      }
    }
    if (reported) this.reportedModel = reported;
    // Until its first turn reports one, Claude runs the model it lists first: its default.
    if (!this.reportedModel) return models?.[0] ? { model: models[0].value } : {};
    return { model: this.modelAliases.get(this.reportedModel) ?? this.reportedModel };
  }

  handle(message: SDKMessage): void {
    switch (message.type) {
      case 'system':
        this.system(message as unknown as Json);
        return;
      case 'stream_event':
        this.transcript.streamEvent(message.event as unknown as Json, message.parent_tool_use_id, this.messageIds);
        return;
      case 'assistant':
        this.transcript.assistant(message.message as unknown as Json, message.parent_tool_use_id);
        if (!message.parent_tool_use_id) {
          this.conversation.lastAssistantUuid = message.uuid;
          this.lastContext = contextOf(message.message as unknown as Json);
        }
        if (message.error) this.notice('error', `Claude: ${message.error}`);
        return;
      case 'user':
        this.transcript.user(
          message.message as unknown as Json,
          message.tool_use_result,
          message.parent_tool_use_id,
          message.isSynthetic ? undefined : (message as { uuid?: string }).uuid,
        );
        return;
      case 'result': {
        const result = message as unknown as Json;
        this.sink.session({ status: 'idle', ...this.usage(result) });
        const stopped = this.conversation.stopping;
        this.conversation.stopping = false;
        if (result.subtype !== 'success' && !stopped) {
          const errors = Array.isArray(result.errors) ? result.errors.join('\n') : '';
          if (result.subtype !== 'error_during_execution' || errors) {
            this.notice('error', errors || `The turn ended: ${String(result.subtype)}`);
          }
        }
        return;
      }
      case 'conversation_reset': {
        const reset = message as unknown as Json;
        this.conversation.sessionId = String(reset.new_conversation_id);
        this.conversation.lastAssistantUuid = null;
        this.lastContext = null;
        this.conversation.before.clear();
        this.sink.reset();
        this.sink.session({ agentSessionId: this.conversation.sessionId });
        return;
      }
      case 'rate_limit_event': {
        const info = (message as unknown as Json).rate_limit_info as Json | undefined;
        if (info?.status === 'rejected') this.notice('warning', 'Usage limit reached');
        return;
      }
    }
  }

  /** A result's own usage is summed over every request in the turn, so the context is the last request's. */
  private usage(result: Json): Pick<ChatSessionInfo, 'usage'> {
    if (!this.lastContext) return {};
    const models = (result.modelUsage ?? {}) as Record<string, Json>;
    const window = this.lastContext.model ? models[this.lastContext.model]?.contextWindow : undefined;
    return {
      usage: { contextTokens: this.lastContext.tokens, contextWindow: typeof window === 'number' ? window : undefined },
    };
  }

  private system(message: Json): void {
    switch (message.subtype) {
      case 'init':
        this.conversation.sessionId = String(message.session_id);
        if (str(message.permissionMode)) this.conversation.mode = message.permissionMode as PermissionMode;
        this.sink.session({
          agentSessionId: this.conversation.sessionId,
          ...this.modelPatch(null, str(message.model)),
          mode: str(message.permissionMode),
          agentVersion: str(message.claude_code_version),
        });
        return;
      case 'status':
        if (str(message.permissionMode)) {
          this.conversation.mode = message.permissionMode as PermissionMode;
          this.sink.session({ mode: this.conversation.mode });
        }
        return;
      case 'session_state_changed':
        if (message.state === 'idle') this.sink.session({ status: 'idle' });
        else if (message.state === 'running') this.sink.session({ status: 'running' });
        return;
      case 'local_command_output':
        this.sink.node({
          id: `claude-local-${String(message.uuid)}`,
          kind: 'assistant_message',
          parentId: null,
          createdAt: Date.now(),
          text: String(message.content ?? ''),
          status: 'completed',
        });
        return;
      case 'background_tasks_changed':
        this.backgroundTasks = (message.tasks ?? []) as Json[];
        this.reportBackground();
        return;
      case 'compact_boundary': {
        const metadata = (message.compact_metadata ?? {}) as Json;
        this.transcript.compaction(String(message.uuid), metadata.trigger === 'manual' ? 'manual' : 'auto');
        return;
      }
      case 'commands_changed': {
        const commands = Array.isArray(message.commands) ? (message.commands as Json[]) : [];
        this.sink.session({
          commands: commands.map((command) => ({
            name: String(command.name),
            description: str(command.description),
            argumentHint: str(command.argumentHint) || undefined,
          })),
        });
        return;
      }
      case 'task_started':
        if (message.task_type === 'local_bash') {
          const id = String(message.task_id);
          this.shells.set(id, {
            description: String(message.description ?? ''),
            startedAt: this.shells.get(id)?.startedAt ?? Date.now(),
            ...(str(message.tool_use_id) && { toolCallId: `claude-tool-${String(message.tool_use_id)}` }),
          });
          // The list can name a task before its start does.
          if (this.backgroundTasks.some((task) => String(task.task_id) === id)) this.reportBackground();
        } else if (str(message.tool_use_id)) {
          const node: SubagentNode = {
            id: `claude-task-${String(message.task_id)}`,
            kind: 'subagent',
            parentId: `claude-tool-${String(message.tool_use_id)}`,
            createdAt: Date.now(),
            title: String(message.description ?? 'Subagent'),
            agentType: str(message.subagent_type),
            status: 'running',
          };
          this.subagents.set(String(message.task_id), node);
          this.sink.node(node);
        }
        return;
      case 'task_notification': {
        const shell = this.shells.get(String(message.task_id));
        if (shell) {
          this.shells.delete(String(message.task_id));
          if (!this.listed.delete(String(message.task_id)) || message.ambient || message.skip_transcript) return;
          const status =
            message.status === 'completed' ? 'completed' : message.status === 'failed' ? 'failed' : 'stopped';
          this.sink.node({
            id: `claude-ended-${String(message.task_id)}`,
            kind: 'notice',
            parentId: null,
            createdAt: Date.now(),
            level: status === 'failed' ? 'error' : 'info',
            text: shell.description,
            ended: { taskId: String(message.task_id), status, ms: Date.now() - shell.startedAt },
          });
          return;
        }
        const node = this.subagents.get(String(message.task_id));
        if (!node) return;
        this.subagents.delete(String(message.task_id));
        const status =
          message.status === 'completed' ? 'completed' : message.status === 'failed' ? 'failed' : 'interrupted';
        this.sink.node({ ...node, status });
        return;
      }
      case 'notification':
      case 'informational':
        if (str(message.text) ?? str(message.message)) this.notice('info', String(message.text ?? message.message));
        return;
    }
  }

  private reportBackground(): void {
    this.sink.session({
      background: this.backgroundTasks
        .filter((task) => !task.ambient && !task.parent_task_id)
        .map((task) => {
          const id = String(task.task_id);
          const description = String(task.description ?? '');
          const shell = task.task_type === 'local_bash';
          const seen = shell ? this.shells : this.agentsSeen;
          if (shell) this.listed.add(id);
          const known = seen.get(id) ?? { description, startedAt: Date.now() };
          seen.set(id, { ...known, description });
          return { id, kind: shell ? ('shell' as const) : ('agent' as const), ...known, description };
        }),
    });
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.sink.node({
      id: `claude-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'notice',
      parentId: null,
      createdAt: Date.now(),
      level,
      text,
    });
  }
}
