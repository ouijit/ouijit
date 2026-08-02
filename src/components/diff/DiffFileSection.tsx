import { useMemo, type ReactNode } from 'react';
import type { FileDiff, DiffHunk } from '../../types';
import type { HunkTokens } from '../../utils/syntaxHighlight';
import { computeWordHighlights } from '../../utils/wordDiff';
import { useSyntaxHighlight } from './useSyntaxHighlight';
import { DiffLineView, anchorForLine, type DiffLineAnchor } from './DiffLineView';
import { badgeColorClass, statusLabel, type DiffFileStatus } from './diffStatus';

/**
 * One file's diff, header and all.
 *
 * The worktree panel and the pull request files view both render this. The PR
 * view supplies the two review slots — content below an anchored line (threads
 * and unsent drafts) and the add-comment handler — and the worktree view
 * supplies neither, so it renders exactly what it always did.
 */

export interface DiffFileSectionProps {
  path: string;
  status: DiffFileStatus | string;
  additions: number;
  deletions: number;
  diff: FileDiff | null;
  /** Content anchored under a specific line — review threads and drafts. */
  renderBelowLine?: (anchor: DiffLineAnchor) => ReactNode;
  /** Enables the per-line comment affordance in the gutter. */
  onAddComment?: (path: string, anchor: DiffLineAnchor) => void;
  /** Extra header content, right-aligned before the stats. */
  headerRight?: ReactNode;
  loadingLabel?: string;
  emptyLabel?: string;
}

export function DiffFileSection({
  path,
  status,
  additions,
  deletions,
  diff,
  renderBelowLine,
  onAddComment,
  headerRight,
  loadingLabel = 'Loading...',
  emptyLabel = 'No diff available',
}: DiffFileSectionProps) {
  const tokens = useSyntaxHighlight(diff, path);

  return (
    <div className="border-b border-ink/[0.08] last:border-b-0" data-path={path}>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-terminal-surface border-b border-ink/[0.06]">
        <span className="flex-1 min-w-0 truncate text-sm text-ink/90" title={path}>
          {path}
        </span>
        {headerRight}
        <span className={`shrink-0 text-[11px] px-1 py-px rounded font-medium ${badgeColorClass(status)}`}>
          {statusLabel(status)}
        </span>
        {(additions > 0 || deletions > 0) && (
          <span className="shrink-0 font-mono text-[13px]">
            {additions > 0 && <span className="text-diff-added">+{additions}</span>}
            {deletions > 0 && <span className="text-diff-removed">-{deletions}</span>}
          </span>
        )}
      </div>
      <div>
        {diff === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
            {loadingLabel}
          </div>
        ) : diff.hunks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">{emptyLabel}</div>
        ) : (
          <div className="min-w-full">
            {diff.hunks.map((hunk, i) => (
              <div key={i}>
                <HunkHeader header={hunk.header} />
                <DiffHunkView
                  hunk={hunk}
                  hunkTokens={tokens?.[i] ?? null}
                  path={path}
                  renderBelowLine={renderBelowLine}
                  onAddComment={onAddComment}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function HunkHeader({ header }: { header: string }) {
  return (
    <div
      className="py-1 pr-4 bg-vcs-renamed/10 text-diff-hunk font-mono text-xs truncate"
      style={{ paddingLeft: '106px' }}
    >
      {header}
    </div>
  );
}

export interface DiffHunkViewProps {
  hunk: DiffHunk;
  hunkTokens: HunkTokens | null;
  path?: string;
  renderBelowLine?: (anchor: DiffLineAnchor) => ReactNode;
  onAddComment?: (path: string, anchor: DiffLineAnchor) => void;
}

export function DiffHunkView({ hunk, hunkTokens, path, renderBelowLine, onAddComment }: DiffHunkViewProps) {
  const wordHighlights = useMemo(() => computeWordHighlights(hunk.lines), [hunk.lines]);

  return (
    <div>
      {hunk.lines.map((line, i) => {
        const anchor = anchorForLine(line);
        const below = anchor && renderBelowLine ? renderBelowLine(anchor) : null;
        return (
          <div key={i}>
            <DiffLineView
              line={line}
              tokens={hunkTokens?.[i] ?? null}
              wordHighlight={wordHighlights.get(i)}
              onAddComment={onAddComment && path ? (a) => onAddComment(path, a) : undefined}
            />
            {below}
          </div>
        );
      })}
    </div>
  );
}
