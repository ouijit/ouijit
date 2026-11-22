import { randomUUID } from 'node:crypto';
import type { DriverSink } from '../../driver';
import type { FileChange, PlanEntry, ToolCallNode, ToolKind } from '../../model';
import { stoppedNode } from '../../model';

export type Json = Record<string, unknown>;
type ContentBlock = Json & { type: string };

function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__')) return 'mcp';
  switch (name) {
    case 'Bash':
    case 'BashOutput':
    case 'KillShell':
      return 'command';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return 'edit';
    case 'Read':
      return 'read';
    case 'Glob':
    case 'Grep':
      return 'search';
    case 'WebFetch':
    case 'WebSearch':
      return 'fetch';
    case 'Task':
    case 'Agent':
      return 'subagent';
    default:
      return 'other';
  }
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function toolTitle(name: string, input: Json): string {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  switch (name) {
    case 'Bash':
      return str(input.description) ?? str(input.command) ?? 'Run a command';
    case 'Read':
      return `Read ${file ?? 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Edit ${file ?? 'a file'}`;
    case 'Write':
      return `Write ${file ?? 'a file'}`;
    case 'Glob':
      return `Find ${str(input.pattern) ?? 'files'}`;
    case 'Grep':
      return `Search for ${str(input.pattern) ?? 'text'}`;
    case 'WebFetch':
      return `Fetch ${str(input.url) ?? 'a page'}`;
    case 'WebSearch':
      return `Search the web for ${str(input.query) ?? ''}`.trim();
    case 'Task':
    case 'Agent':
      return str(input.description) ?? 'Run a subagent';
    default:
      if (name.startsWith('mcp__')) {
        const [, server, tool] = name.split('__');
        return `${server}: ${tool ?? ''}`.trim();
      }
      return name;
  }
}

function toolFiles(name: string, input: Json): FileChange[] {
  const file = str(input.file_path) ?? str(input.notebook_path);
  if (!file || toolKind(name) !== 'edit') return [];
  return [{ path: file, change: name === 'Write' ? 'add' : 'modify' }];
}

interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function unifiedDiff(path: string, hunks: StructuredPatchHunk[]): string {
  const body = hunks.map(
    (hunk) => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`,
  );
  return `--- a/${path}\n+++ b/${path}\n${body.join('\n')}`;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: Json) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

function todoEntries(input: Json): PlanEntry[] {
  const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : [];
  return todos.map((todo) => ({
    text: str(todo.content) ?? str(todo.activeForm) ?? '',
    status: todo.status === 'completed' ? 'completed' : todo.status === 'in_progress' ? 'in_progress' : 'pending',
  }));
}

function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part: Json) => part.type === 'text')
    .map((part: Json) => String(part.text ?? ''))
    .join('\n');
}

export const USER_PREFIX = 'user-';

/** Claude records a stop as a user message of its own, after the results of any tools it cut off. */
const INTERRUPTED = /^\[Request interrupted by user( for tool use)?\]$/;

/**
 * Translates Claude's message stream into transcript nodes. Ids derive from
 * what the CLI writes to its session file — the API message id and the
 * block's place in it, the tool_use id, the user message uuid — so the live
 * stream and a history import produce the same nodes.
 */
export class ClaudeTranscript {
  private blockOrdinals = new Map<string, number>();
  private readonly tools = new Map<string, ToolCallNode>();
  private plan: PlanEntry[] = [];
  private tasks = new Map<string, PlanEntry>();
  /** A tool cut off by a stop reads as rejected until the stop's own message says otherwise. */
  private rejected: string[] = [];
  /** When the message being translated was written, for a history import; live messages are stamped as they arrive. */
  at: number | null = null;

  commandOf(toolUseId: string): string | undefined {
    return this.tools.get(toolUseId)?.command;
  }

  constructor(private readonly sink: Pick<DriverSink, 'node' | 'append'>) {}

  private now(): number {
    return this.at ?? Date.now();
  }

  compaction(uuid: string, trigger: 'manual' | 'auto'): void {
    this.sink.node({
      id: `claude-compact-${uuid}`,
      kind: 'compaction',
      parentId: null,
      createdAt: this.now(),
      trigger,
    });
  }

  private parent(parentToolUseId: string | null | undefined): string | null {
    return parentToolUseId ? `claude-tool-${parentToolUseId}` : null;
  }

  streamEvent(event: Json, parentToolUseId: string | null, messageIds: Map<string | null, string>): void {
    const parentId = this.parent(parentToolUseId);
    switch (event.type) {
      case 'message_start': {
        const message = event.message as Json;
        messageIds.set(parentToolUseId, String(message.id));
        return;
      }
      case 'content_block_start': {
        const messageId = messageIds.get(parentToolUseId);
        const block = event.content_block as ContentBlock;
        if (!messageId) return;
        const id = `claude-${messageId}-${String(event.index)}`;
        if (block.type === 'text') {
          this.sink.node({
            id,
            kind: 'assistant_message',
            parentId,
            createdAt: this.now(),
            text: '',
            status: 'running',
          });
        } else if (block.type === 'thinking') {
          this.sink.node({ id, kind: 'reasoning', parentId, createdAt: this.now(), text: '', status: 'running' });
        }
        return;
      }
      case 'content_block_delta': {
        const messageId = messageIds.get(parentToolUseId);
        const delta = event.delta as Json;
        if (!messageId) return;
        const id = `claude-${messageId}-${String(event.index)}`;
        if (delta.type === 'text_delta') this.sink.append(id, 'text', String(delta.text ?? ''));
        else if (delta.type === 'thinking_delta') this.sink.append(id, 'text', String(delta.thinking ?? ''));
        return;
      }
    }
  }

  assistant(message: Json, parentToolUseId: string | null): void {
    this.rejected = [];
    const parentId = this.parent(parentToolUseId);
    const messageId = String(message.id);
    const content = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
    for (const block of content) {
      const ordinal = this.blockOrdinals.get(messageId) ?? 0;
      this.blockOrdinals.set(messageId, ordinal + 1);
      const id = `claude-${messageId}-${ordinal}`;
      const createdAt = this.now();
      if (block.type === 'text') {
        this.sink.node({
          id,
          kind: 'assistant_message',
          parentId,
          createdAt,
          text: String(block.text ?? ''),
          status: 'completed',
        });
      } else if (block.type === 'thinking') {
        this.sink.node({
          id,
          kind: 'reasoning',
          parentId,
          createdAt,
          text: String(block.thinking ?? ''),
          status: 'completed',
        });
      } else if (block.type === 'tool_use') {
        this.toolUse(block, parentId);
      }
    }
  }

  private toolUse(block: ContentBlock, parentId: string | null): void {
    const name = String(block.name);
    const input = (block.input ?? {}) as Json;
    if (name === 'TodoWrite') {
      this.plan = todoEntries(input);
      this.emitPlan(parentId);
      return;
    }
    const node: ToolCallNode = {
      id: `claude-tool-${String(block.id)}`,
      kind: 'tool_call',
      parentId,
      createdAt: this.now(),
      tool: toolKind(name),
      name,
      title: toolTitle(name, input),
      input,
      command: name === 'Bash' ? str(input.command) : undefined,
      output: '',
      files: toolFiles(name, input),
      status: 'running',
    };
    this.tools.set(String(block.id), node);
    this.sink.node(node);
    if (name === 'TaskUpdate' && str(input.taskId)) {
      const entry = this.tasks.get(String(input.taskId));
      if (entry && (input.status === 'completed' || input.status === 'in_progress' || input.status === 'pending')) {
        entry.status = input.status;
        this.emitTasks(parentId);
      }
    }
  }

  user(message: Json, structured: unknown, parentToolUseId: string | null, uuid: string | undefined): void {
    const content = message.content;
    const results = Array.isArray(content)
      ? (content as ContentBlock[]).filter((part) => part.type === 'tool_result')
      : [];
    if (results.length === 0) {
      const text = userText(content);
      if (INTERRUPTED.test(text.trim())) this.stopped(uuid ?? randomUUID(), parentToolUseId);
      else if (uuid) this.userMessage(uuid, text, parentToolUseId);
      return;
    }
    this.rejected = [];
    for (const result of results) {
      const node = this.tools.get(String(result.tool_use_id));
      if (!node) continue;
      const updated: ToolCallNode = {
        ...node,
        output: resultText(result.content),
        status: result.is_error ? 'failed' : 'completed',
        files: this.filesFrom(node, structured),
      };
      this.tools.set(String(result.tool_use_id), updated);
      this.sink.node(updated);
      if (result.is_error) this.rejected.push(String(result.tool_use_id));
      if (node.name === 'TaskCreate') this.taskCreated(node, structured);
    }
  }

  private stopped(uuid: string, parentToolUseId: string | null): void {
    for (const toolUseId of this.rejected.splice(0)) {
      const node = this.tools.get(toolUseId);
      if (!node) continue;
      const stopped: ToolCallNode = { ...node, status: 'interrupted' };
      this.tools.set(toolUseId, stopped);
      this.sink.node(stopped);
    }
    if (!parentToolUseId) this.sink.node(stoppedNode(`claude-stopped-${uuid}`));
  }

  private userMessage(uuid: string, text: string, parentToolUseId: string | null): void {
    if (parentToolUseId || !text || text.startsWith('<')) return;
    this.sink.node({
      id: `${USER_PREFIX}${uuid}`,
      kind: 'user_message',
      parentId: null,
      createdAt: this.now(),
      text,
      attachments: [],
      delivery: 'prompt',
    });
  }

  private filesFrom(node: ToolCallNode, structured: unknown): FileChange[] {
    if (node.tool !== 'edit' || !structured || typeof structured !== 'object') return node.files;
    const output = structured as Json;
    const path = str(output.filePath) ?? node.files[0]?.path;
    const hunks = Array.isArray(output.structuredPatch) ? (output.structuredPatch as StructuredPatchHunk[]) : [];
    if (!path) return node.files;
    const gitDiff = output.gitDiff as Json | undefined;
    const diff = str(gitDiff?.patch) ?? (hunks.length ? unifiedDiff(path, hunks) : undefined);
    const change = output.type === 'create' ? 'add' : (node.files[0]?.change ?? 'modify');
    return [{ path, change, diff }];
  }

  private taskCreated(node: ToolCallNode, structured: unknown): void {
    const output = (structured ?? {}) as Json;
    const task = (output.task ?? output) as Json;
    const id = str(task.id) ?? (typeof task.id === 'number' ? String(task.id) : undefined);
    const input = node.input as Json;
    if (!id) return;
    this.tasks.set(id, { text: str(input.subject) ?? str(task.subject) ?? node.title, status: 'pending' });
    this.emitTasks(node.parentId);
  }

  private emitTasks(parentId: string | null): void {
    this.plan = [...this.tasks.values()].map((entry) => ({ ...entry }));
    this.emitPlan(parentId);
  }

  private emitPlan(parentId: string | null): void {
    this.sink.node({ id: 'claude-plan', kind: 'plan', parentId, createdAt: this.now(), entries: this.plan });
  }
}
