import type { GithubIssue } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { labelStyle, since } from './prFormat';

interface IssueListProps {
  issues: GithubIssue[];
  /** Issue number → task number, when a task already tracks it. */
  linkedTasks: Record<number, number>;
  onCreateTask: (issueNumber: number) => void;
  onOpenExternal: (url: string) => void;
}

/**
 * Open issues, each with a one-click path to a task carrying the issue body as
 * its description. A PR later opened from that task closes the issue on merge,
 * because the closing keyword goes into the PR body automatically.
 */
export function IssueList({ issues, linkedTasks, onCreateTask, onOpenExternal }: IssueListProps) {
  if (issues.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
        <Icon name="circle-dashed" className="w-8 h-8 opacity-40" />
        <span className="text-sm">No open issues</span>
      </div>
    );
  }

  return (
    <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06] bg-terminal-bg">
      {issues.map((issue) => {
        const linked = linkedTasks[issue.number];
        return (
          <div key={issue.number} className="flex items-start gap-3 px-4 py-3">
            <Icon name="circle-dashed" className="w-4 h-4 mt-0.5 shrink-0 text-vcs-added" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span className="text-sm text-text-primary truncate">{issue.title}</span>
                {issue.labels.slice(0, 3).map((label) => (
                  <span
                    key={label.name}
                    className="shrink-0 text-[10px] px-1.5 py-px rounded-full"
                    style={labelStyle(label.color)}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1 text-xs text-text-tertiary">
                <span className="font-mono">#{issue.number}</span>
                <span>{issue.author}</span>
                <span>{since(issue.updatedAt)}</span>
                {issue.isMine && <span>assigned to you</span>}
              </div>
            </div>
            {linked != null ? (
              <span className="shrink-0 text-xs font-mono text-text-tertiary">task #{linked}</span>
            ) : (
              <button
                type="button"
                className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-ink/[0.08] text-text-primary hover:bg-ink/[0.12]"
                onClick={() => onCreateTask(issue.number)}
              >
                Create task
              </button>
            )}
            <button
              type="button"
              className="shrink-0 w-6 h-6 rounded text-text-tertiary hover:text-text-primary flex items-center justify-center"
              title="Open on GitHub"
              onClick={() => onOpenExternal(issue.url)}
            >
              <Icon name="arrow-square-out" className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
