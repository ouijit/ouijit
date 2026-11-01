import { memo, useState, type ReactNode } from 'react';
import { Icon } from '../terminal/Icon';
import { Markdown } from '../issues/Markdown';
import { ChatMarkdown } from './ChatMarkdown';
import { terminalInstances } from '../terminal/terminalRegistry';
import { ChatRequestView } from './ChatRequest';
import type {
  ChatNode,
  FileChange,
  NodeStatus,
  PlanNode,
  ToolCallNode,
  ToolKind,
  UserMessageNode,
} from '../../chat/model';

const TOOL_ICONS: Record<ToolKind, string> = {
  command: 'terminal',
  edit: 'pencil-simple',
  read: 'file-text',
  search: 'magnifying-glass',
  fetch: 'globe-simple',
  mcp: 'cube',
  subagent: 'users',
  other: 'code',
};

function StatusMark({ status }: { status: NodeStatus }) {
  switch (status) {
    case 'pending':
    case 'running':
      return (
        <span
          className="w-2.5 h-2.5 rounded-full border-[1.5px] border-ink/25 border-t-ink/70 shrink-0"
          style={{ animation: 'loading-dot-spin 0.8s linear infinite' }}
          aria-label="Running"
        />
      );
    case 'completed':
      return <Icon name="check" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />;
    case 'failed':
      return <Icon name="x-circle" className="w-3.5 h-3.5 text-error shrink-0" />;
    case 'declined':
    case 'interrupted':
      return <Icon name="prohibit" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />;
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
function relativeToCard(text: string, cardId: string): string {
  const root = terminalInstances.get(cardId)?.worktreePath;
  return root ? text.split(`${root}/`).join('') : text;
}

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
        <Icon name={TOOL_ICONS[node.tool]} className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
        <span className="flex-1 truncate">{relativeToCard(node.title, cardId)}</span>
        {node.files.map((file) => {
          const counts = fileCounts(file);
          return counts ? (
            <span key={file.path} className="font-mono text-[11px] shrink-0">
              <span className="text-[var(--color-diff-added)]">+{counts.added}</span>{' '}
              <span className="text-[var(--color-diff-removed)]">−{counts.removed}</span>
            </span>
          ) : null;
        })}
        <StatusMark status={node.status} />
      </button>
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
                    <span className="font-mono truncate">{relativeToCard(file.path, cardId)}</span>
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
          <span className={entry.status === 'completed' ? 'text-text-tertiary line-through' : 'text-text-primary'}>
            {entry.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReasoningView({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text && !running) return null;
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
        <Icon name={open ? 'caret-down' : 'caret-right'} className="w-3 h-3" />
      </button>
      {open && <div className="ml-5 whitespace-pre-wrap text-text-tertiary text-[13px] leading-relaxed">{text}</div>}
    </div>
  );
}

function UserMessageView({ node, onRewind }: { node: UserMessageNode; onRewind?: () => void }) {
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
}

export const ChatNodeView = memo(function ChatNodeView({ node, context }: { node: ChatNode; context: NodeContext }) {
  const nested = context.children.get(node.id);
  const childViews = nested?.map((child) => <ChatNodeView key={child.id} node={child} context={context} />);
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
      return <ReasoningView text={node.text} running={node.status === 'running'} />;
    case 'tool_call':
      return (
        <ToolCallView node={node} cardId={context.cardId}>
          {childViews}
        </ToolCallView>
      );
    case 'subagent':
      return (
        <div className="text-sm">
          <div className="flex items-center gap-2 py-1 text-text-secondary">
            <Icon name="users" className="w-3.5 h-3.5 text-text-tertiary" />
            <span className="flex-1 truncate">{node.title}</span>
            <StatusMark status={node.status} />
          </div>
          {childViews && <div className="ml-5 border-l border-separator pl-3 flex flex-col gap-1">{childViews}</div>}
        </div>
      );
    case 'plan':
      return <PlanView node={node} />;
    case 'request':
      return <ChatRequestView node={node} cardId={context.cardId} />;
    case 'notice':
      return (
        <div
          className={`text-[13px] ${node.level === 'error' ? 'text-error' : node.level === 'warning' ? 'text-text-secondary' : 'text-text-tertiary'}`}
        >
          {node.text}
        </div>
      );
    case 'compaction':
      return (
        <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
          <div className="flex-1 border-t border-separator" />
          Context compacted
          <div className="flex-1 border-t border-separator" />
        </div>
      );
  }
});
