import { memo, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../terminal/Icon';
import { Markdown } from '../issues/Markdown';
import { ChatMarkdown } from './ChatMarkdown';
import { terminalInstances } from '../terminal/terminalRegistry';
import { ChatRequestView, stepTitle } from './ChatRequest';
import type {
  ChatNode,
  FileChange,
  NodeStatus,
  NoticeNode,
  PlanNode,
  ToolCallNode,
  ToolKind,
  UserMessageNode,
} from '../../chat/model';
import { relativeToCard } from './cardPaths';

const TOOL_ICONS: Record<ToolKind, string> = {
  command: 'terminal',
  edit: 'pencil-simple',
  read: 'file-text',
  search: 'magnifying-glass',
  fetch: 'globe-simple',
  mcp: 'cube',
  subagent: 'flow-arrow',
  other: 'code',
};

/**
 * A row's state, in the slot its icon holds: the icon while all is well, and
 * in its place a spinner, a failure or a refusal. A finished fold is already
 * done, so a done row needs no mark of its own.
 */
function StateMark({ status, icon }: { status: NodeStatus; icon: string }) {
  const mark = (label: string, children: ReactNode) => (
    <span role="img" aria-label={label} className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
      {children}
    </span>
  );
  switch (status) {
    case 'pending':
    case 'running':
      return mark(
        'Running',
        <span
          className="w-2.5 h-2.5 rounded-full border-[1.5px] border-ink/25 border-t-ink/70"
          style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
        />,
      );
    case 'failed':
      return mark('Failed', <Icon name="x" className="w-3.5 h-3.5 text-error" />);
    case 'declined':
      return mark('Declined', <Icon name="prohibit" className="w-3.5 h-3.5 text-text-tertiary" />);
    case 'interrupted':
      return mark('Stopped', <Icon name="prohibit" className="w-3.5 h-3.5 text-text-tertiary" />);
    case 'completed':
      return <Icon name={icon} className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />;
  }
}

function diffLineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-[var(--color-diff-added)]';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-[var(--color-diff-removed)]';
  if (line.startsWith('@@')) return 'text-text-tertiary';
  return 'text-text-secondary';
}

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split('\n').filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '));
  return (
    <pre className="font-mono text-[12px] leading-[1.45] overflow-x-auto max-h-80 rounded-[8px] bg-ink/[0.04] px-3 py-2">
      {lines.map((line, index) => (
        <div key={index} className={diffLineClass(line)}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

function fileCounts(file: FileChange): { added: number; removed: number } | null {
  if (!file.diff) return null;
  let added = 0;
  let removed = 0;
  for (const line of file.diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

function openDiff(cardId: string): void {
  terminalInstances.get(cardId)?.setDiffPanelOpen(true);
}

/** Agents name files by absolute path; inside the card's own worktree the rest of the path says nothing. */
function ToolCallView({ node, cardId, children }: { node: ToolCallNode; cardId: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(node.command || node.output || node.files.some((f) => f.diff) || children);
  return (
    <div className="text-sm">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-1 text-left text-text-secondary hover:text-text-primary transition-colors duration-100 disabled:hover:text-text-secondary"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasDetail}
        aria-expanded={open}
      >
        <StateMark status={node.status} icon={TOOL_ICONS[node.tool]} />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{relativeToCard(node.title, cardId)}</span>
        <StepSpan node={node} />
        {node.files.map((file) => {
          const counts = fileCounts(file);
          return counts ? (
            <span key={file.path} className="font-mono text-[11px] shrink-0">
              <span className="text-[var(--color-diff-added)]">+{counts.added}</span>{' '}
              <span className="text-[var(--color-diff-removed)]">−{counts.removed}</span>
            </span>
          ) : null;
        })}
      </button>
      {!open && node.status === 'running' && node.output && (
        <pre className="ml-5 mb-1 font-mono text-[12px] leading-[1.45] text-text-tertiary whitespace-pre overflow-hidden rounded-[8px] bg-ink/[0.04] px-3 py-2">
          {lastLines(node.output, TAIL_LINES)}
        </pre>
      )}
      {open && (
        <div className="ml-5 mt-1 mb-2 flex flex-col gap-2">
          {node.command && node.command !== node.title && (
            <pre className="font-mono text-[12px] text-text-secondary whitespace-pre-wrap break-all">
              $ {node.command}
            </pre>
          )}
          {node.files.map(
            (file) =>
              file.diff && (
                <div key={file.path} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
                    <span className="font-mono overflow-hidden whitespace-nowrap">
                      {relativeToCard(file.path, cardId)}
                    </span>
                    <button
                      type="button"
                      className="ml-auto hover:text-text-primary transition-colors duration-100"
                      onClick={() => openDiff(cardId)}
                    >
                      Open diff
                    </button>
                  </div>
                  <DiffBlock diff={file.diff} />
                </div>
              ),
          )}
          {node.output && !node.files.some((f) => f.diff) && (
            <pre className="font-mono text-[12px] leading-[1.45] text-text-secondary whitespace-pre-wrap break-words max-h-72 overflow-y-auto rounded-[8px] bg-ink/[0.04] px-3 py-2">
              {node.output}
            </pre>
          )}
          {children && <div className="border-l border-separator pl-3 flex flex-col gap-1">{children}</div>}
        </div>
      )}
    </div>
  );
}

/** The mark for how background work ended, here and in the bar. */
export function EndedMark({ status }: { status: NonNullable<NoticeNode['ended']>['status'] }) {
  const name = status === 'failed' ? 'x' : status === 'stopped' ? 'prohibit' : 'check';
  return (
    <Icon name={name} className={`w-3.5 h-3.5 shrink-0 ${status === 'failed' ? 'text-error' : 'text-text-tertiary'}`} />
  );
}

/** Background work that ended, where it ended: its mark says how, so the line is only its name and time. */
function EndedLine({ ended, text }: { ended: NonNullable<NoticeNode['ended']>; text: string }) {
  return (
    <div className="chat-said-in flex items-center gap-2 text-[13px] text-text-tertiary">
      <EndedMark status={ended.status} />
      <span className="min-w-0 break-words">{text}</span>
      <Span ms={ended.ms} />
    </div>
  );
}

/** Every step under a node, depth first, for a subagent's count and its latest step. */
function stepsUnder(id: string, children: NodeContext['children']): ChatNode[] {
  return (children.get(id) ?? []).flatMap((child) => [
    ...(child.kind === 'tool_call' ? [child] : []),
    ...stepsUnder(child.id, children),
  ]);
}

/**
 * One line however much a subagent does, so a turn that fans out to many of
 * them stays readable: its latest step while it runs, and the rest on click.
 */
function SubagentView({
  title,
  status,
  node,
  steps,
  output,
  cardId,
  children,
}: {
  title: string;
  status: NodeStatus;
  node: ChatNode;
  steps: ChatNode[];
  output?: string;
  cardId: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const latest = steps.at(-1);
  const running = status === 'running' || status === 'pending';
  const now = useNow(running);
  const end = running ? now : subagentEnd(node, steps);
  return (
    <div className="text-sm">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-1 text-left text-text-secondary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <StateMark status={status} icon="flow-arrow" />
        <span className="min-w-0 overflow-hidden whitespace-nowrap">{title}</span>
        <Span ms={end === undefined ? undefined : end - node.createdAt} className="text-text-tertiary" />
        {steps.length > 0 && (
          <span className="shrink-0 text-[12px] text-text-tertiary tabular-nums">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        )}
        {running && latest && 'title' in latest && (
          <span className="overflow-hidden whitespace-nowrap min-w-0 flex-1 basis-0 text-text-tertiary">
            {relativeToCard(latest.title, cardId)}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-5 mt-1 mb-2 border-l border-separator pl-3 flex flex-col gap-1">
          {children}
          {output && (
            <pre className="font-mono text-[12px] leading-[1.45] text-text-secondary whitespace-pre-wrap break-words max-h-72 overflow-y-auto rounded-[8px] bg-ink/[0.04] px-3 py-2">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A subagent node carries no end of its own, and a call that launched one in
 * the background ends long before it does, so the last step to end stands in.
 */
function subagentEnd(node: ChatNode, steps: ChatNode[]): number | undefined {
  const ends = [node, ...steps].flatMap((n) => (n.kind === 'tool_call' && n.endedAt !== undefined ? [n.endedAt] : []));
  return ends.length > 0 ? Math.max(...ends) : undefined;
}

function isSubagent(node: ChatNode): boolean {
  return node.kind === 'subagent' || (node.kind === 'tool_call' && node.tool === 'subagent');
}

/** A subagent run in the background outlives the call that launched it, so its own status wins. */
function subagentStatus(node: ChatNode, context: NodeContext): NodeStatus {
  if (node.kind === 'subagent') return node.status;
  const status = (node as ToolCallNode).status;
  if (status === 'failed' || status === 'declined' || status === 'interrupted') return status;
  const inner = context.children.get(node.id)?.find((child) => child.kind === 'subagent');
  return inner?.status ?? status;
}

const GROUP_FROM = 3;

/** Subagents launched together, as one line of counts until opened. */
function SubagentGroup({ nodes, context }: { nodes: ChatNode[]; context: NodeContext }) {
  const [open, setOpen] = useState(false);
  const statuses = nodes.map((node) => subagentStatus(node, context));
  const running = statuses.filter((s) => s === 'running' || s === 'pending').length;
  const failed = statuses.filter((s) => s === 'failed').length;
  const done = statuses.filter((s) => s === 'completed').length;
  const stopped = nodes.length - running - failed - done;
  const counts = [
    running && `${running} running`,
    done && `${done} done`,
    failed && `${failed} failed`,
    stopped && `${stopped} stopped`,
  ].filter(Boolean);
  const overall: NodeStatus = running ? 'running' : failed ? 'failed' : stopped && !done ? 'interrupted' : 'completed';
  return (
    <div className="text-sm">
      <button
        type="button"
        className="w-full flex items-center gap-2 py-1 text-left text-text-secondary hover:text-text-primary transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <StateMark status={overall} icon="flow-arrow" />
        <span className="shrink-0">{nodes.length} subagents</span>
        <span
          className={`overflow-hidden whitespace-nowrap min-w-0 flex-1 ${failed ? 'text-error' : 'text-text-tertiary'}`}
        >
          {counts.join(' · ')}
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-1 mb-2 border-l border-separator pl-3 flex flex-col gap-1">
          {nodes.map((node) => (
            <ChatNodeView key={node.id} node={node} context={context} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Claude sends a thought with no text unless the session asks for summaries; such a thought shows nothing. */
export function isEmptyThought(node: ChatNode): boolean {
  return node.kind === 'reasoning' && !node.text.trim();
}

/** A thought in the story's order, in the grey of work: often where the agent says what it is about to do. */
export function ThoughtLine({ text }: { text: string }) {
  return <div className="text-[13px] leading-relaxed text-text-tertiary whitespace-pre-wrap break-words">{text}</div>;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a stretch of work amounted to, in one line: what was run, read, changed and said. */
export function foldSummary(nodes: ChatNode[]): string {
  let commands = 0;
  let reads = 0;
  let searches = 0;
  let fetches = 0;
  let others = 0;
  let subagents = 0;
  let said = 0;
  const edited = new Set<string>();
  for (const node of nodes) {
    if (node.kind === 'subagent') subagents++;
    if (node.kind === 'assistant_message' && node.text.trim()) said++;
    if (node.kind !== 'tool_call') continue;
    switch (node.tool) {
      case 'command':
        commands++;
        break;
      case 'edit':
        if (node.files.length) node.files.forEach((file) => edited.add(file.path));
        else edited.add(node.id);
        break;
      case 'read':
        reads++;
        break;
      case 'search':
        searches++;
        break;
      case 'fetch':
        fetches++;
        break;
      case 'subagent':
        subagents++;
        break;
      default:
        others++;
    }
  }
  const parts = [
    commands && `ran ${count(commands, 'command')}`,
    edited.size && `edited ${count(edited.size, 'file')}`,
    reads && `read ${count(reads, 'file')}`,
    searches && count(searches, 'search', 'searches'),
    fetches && `fetched ${count(fetches, 'page')}`,
    subagents && count(subagents, 'subagent'),
    others && count(others, 'tool call'),
    said && `said ${count(said, 'thing')}`,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return 'Thought';
  const line = parts.join(', ');
  return line[0].toUpperCase() + line.slice(1);
}

/** A duration placed right after the line it belongs to, " · 19s"; nothing under a second. */
/** How much of a running command's output shows under it before it is opened. */
const TAIL_LINES = 4;

function lastLines(text: string, count: number): string {
  return text.replace(/\s+$/, '').split('\n').slice(-count).join('\n');
}

/** The time now, a second at a time while `ticking`. */
export function useNow(ticking = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/** How long a step took, or has taken so far. */
function StepSpan({ node }: { node: ToolCallNode }) {
  const running = node.status === 'running' || node.status === 'pending';
  const now = useNow(running);
  const end = running ? now : node.endedAt;
  return end === undefined ? null : <Span ms={end - node.createdAt} className="text-text-tertiary" />;
}

export function Span({ ms, className = '' }: { ms: number | undefined; className?: string }) {
  const span = ms === undefined ? '' : formatSpan(ms);
  // A flex item drops its leading space unless whitespace is kept; -ml-2 takes back the row's gap.
  return span ? (
    <span className={`shrink-0 -ml-2 tabular-nums whitespace-pre ${className}`}>{` · ${span}`}</span>
  ) : null;
}

export function formatSpan(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A run of sibling nodes, with subagents launched together folded into a group. */
export function ChatNodeList({
  nodes,
  context,
  thoughtsAsText,
}: {
  nodes: ChatNode[];
  context: NodeContext;
  /** Inside an opened fold a thought is already behind a click, so it is not one more toggle. */
  thoughtsAsText?: boolean;
}) {
  const items: ReactNode[] = [];
  for (let i = 0; i < nodes.length;) {
    let end = i;
    const node = nodes[i];
    if (thoughtsAsText && node.kind === 'reasoning') {
      if (node.text.trim()) items.push(<ThoughtLine key={node.id} text={node.text.trim()} />);
      i++;
      continue;
    }
    while (end < nodes.length && isSubagent(nodes[end])) end++;
    if (end - i >= GROUP_FROM) {
      items.push(<SubagentGroup key={nodes[i].id} nodes={nodes.slice(i, end)} context={context} />);
      i = end;
    } else {
      items.push(<ChatNodeView key={nodes[i].id} node={nodes[i]} context={context} />);
      i++;
    }
  }
  return <>{items}</>;
}

function PlanView({ node }: { node: PlanNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {node.proposal && <Markdown body={node.proposal} />}
      {node.entries.map((entry, index) => (
        <div key={index} className="flex items-start gap-2">
          <Icon
            name={
              entry.status === 'completed' ? 'check-circle' : entry.status === 'in_progress' ? 'circle-half' : 'circle'
            }
            className={`w-3.5 h-3.5 mt-[3px] shrink-0 ${entry.status === 'in_progress' ? 'text-accent' : 'text-text-tertiary'}`}
          />
          <span
            className={`min-w-0 break-words ${entry.status === 'completed' ? 'text-text-tertiary line-through' : 'text-text-primary'}`}
          >
            {entry.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReasoningView({ text, running, ms }: { text: string; running: boolean; ms: number | undefined }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="text-sm">
      <button
        type="button"
        className="flex items-center gap-2 py-1 text-text-tertiary hover:text-text-secondary transition-colors duration-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name="brain" className="w-3.5 h-3.5" />
        <span>{running ? 'Thinking' : 'Thought'}</span>
        {!running && <Span ms={ms} />}
        <Icon name={open ? 'caret-down' : 'caret-right'} className="w-3 h-3" />
      </button>
      {open && <div className="ml-5 whitespace-pre-wrap text-text-tertiary text-[13px] leading-relaxed">{text}</div>}
    </div>
  );
}

function UserMessageView({ node, onRewind }: { node: UserMessageNode; onRewind?: () => void }) {
  if (node.wake) {
    return <div className="text-[13px] text-text-tertiary whitespace-pre-wrap break-words">{node.text}</div>;
  }
  return (
    <div className="group/user flex flex-col items-end gap-1">
      <div className="max-w-[85%] rounded-[12px] bg-ink/[0.07] px-3 py-2 text-sm text-text-primary whitespace-pre-wrap break-words">
        {node.text}
        {node.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {node.attachments.map((attachment) => (
              <span key={attachment.path} className="inline-flex items-center gap-1 text-[12px] text-text-secondary">
                <Icon name="paperclip" className="w-3 h-3" />
                {attachment.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-text-tertiary min-h-4">
        {node.delivery === 'queued' && <span>Queued</span>}
        {node.delivery === 'steer' && <span>Sent mid-turn</span>}
        {onRewind && (
          <button
            type="button"
            className="opacity-0 group-hover/user:opacity-100 hover:text-text-primary transition-opacity duration-100"
            onClick={onRewind}
          >
            Rewind to here
          </button>
        )}
      </div>
    </div>
  );
}

export interface NodeContext {
  cardId: string;
  children: Map<string | null, ChatNode[]>;
  canRewind: boolean;
  onRewind: (nodeId: string) => void;
  /** Background tasks the bar is showing, whose endings wait until it lets them go. */
  inBar?: ReadonlySet<string>;
}

export const ChatNodeView = memo(function ChatNodeView({ node, context }: { node: ChatNode; context: NodeContext }) {
  const nested = context.children.get(node.id);
  const childViews = nested && <ChatNodeList nodes={nested} context={context} />;
  switch (node.kind) {
    case 'user_message':
      return (
        <UserMessageView
          node={node}
          onRewind={context.canRewind && node.parentId === null ? () => context.onRewind(node.id) : undefined}
        />
      );
    case 'assistant_message':
      return node.text ? <ChatMarkdown text={node.text} complete={node.status !== 'running'} /> : null;
    case 'reasoning':
      return (
        <ReasoningView
          text={node.text}
          running={node.status === 'running'}
          ms={node.endedAt === undefined ? undefined : node.endedAt - node.createdAt}
        />
      );
    case 'tool_call':
      if (node.tool === 'subagent') {
        const inner = nested?.find((child) => child.kind === 'subagent');
        return (
          <SubagentView
            title={inner?.title ?? node.title}
            status={subagentStatus(node, context)}
            node={node}
            steps={stepsUnder(node.id, context.children)}
            output={node.output}
            cardId={context.cardId}
          >
            {nested
              ?.filter((child) => child.kind !== 'subagent')
              .map((child) => (
                <ChatNodeView key={child.id} node={child} context={context} />
              ))}
          </SubagentView>
        );
      }
      return (
        <ToolCallView node={node} cardId={context.cardId}>
          {childViews}
        </ToolCallView>
      );
    case 'subagent':
      return (
        <SubagentView
          title={node.title}
          status={node.status}
          node={node}
          steps={stepsUnder(node.id, context.children)}
          cardId={context.cardId}
        >
          {childViews}
        </SubagentView>
      );
    case 'plan':
      return <PlanView node={node} />;
    case 'request': {
      const call = [...context.children.values()]
        .flat()
        .find((other): other is ToolCallNode => other.kind === 'tool_call' && other.id === node.toolCallId);
      return (
        <ChatRequestView
          node={node}
          cardId={context.cardId}
          command={call?.tool === 'command' ? call.command : undefined}
          step={call ? stepTitle(call) : undefined}
        />
      );
    }
    case 'notice':
      if (node.ended) return <EndedLine ended={node.ended} text={node.text} />;
      return (
        <div
          className={`text-[13px] break-words ${node.level === 'error' ? 'text-error' : node.level === 'warning' ? 'text-text-secondary' : 'text-text-tertiary'}`}
        >
          {node.text}
        </div>
      );
    case 'compaction':
      return <div className="text-[13px] text-text-tertiary">Context compacted</div>;
  }
});
