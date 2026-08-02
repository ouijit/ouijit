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
  /**
   * Shown in place of the hunks when git reports the file as binary. Without
   * one, a binary file says so rather than claiming there is no diff.
   */
  binaryView?: ReactNode;
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
  binaryView,
  loadingLabel = 'Loading...',
  emptyLabel = 'No diff available',
}: DiffFileSectionProps) {
  const tokens = useSyntaxHighlight(diff, path);

  return (
    <div className="last:border-b-0" data-path={path}>
      {/* The directory is context and the filename is the subject, so they are
          not set at the same weight. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface border-y border-ink/[0.06]">
        <span className="flex-1 min-w-0 truncate font-mono text-[13px]" title={path}>
          <span className="text-ink/35">{dirname(path)}</span>
          <span className="text-ink/90">{basename(path)}</span>
        </span>
        {headerRight}
        <span className={`shrink-0 text-[10px] px-1 py-px rounded font-medium ${badgeColorClass(status)}`}>
          {statusLabel(status)}
        </span>
        {(additions > 0 || deletions > 0) && (
          <span className="shrink-0 font-mono text-[11px]">
            {additions > 0 && <span className="text-diff-added">+{additions}</span>}
            {additions > 0 && deletions > 0 && ' '}
            {deletions > 0 && <span className="text-diff-removed">-{deletions}</span>}
          </span>
        )}
      </div>
      <div>
        {diff === null ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
            {loadingLabel}
          </div>
        ) : diff.binary ? (
          (binaryView ?? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-text-tertiary">Binary file</div>
          ))
        ) : diff.hunks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">{emptyLabel}</div>
        ) : (
          <div className="min-w-full">
            {diff.hunks.map((hunk, i) => (
              <div key={i}>
                {/* The first hunk needs no boundary; the file header is one. */}
                <HunkHeader header={hunk.header} first={i === 0} />
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

/**
 * `@@ -12,7 +12,10 @@ export function readToken()`.
 *
 * The line numbers are the least useful part — the gutter beside every line
 * already carries them — and the enclosing function is the most useful, so the
 * range is dimmed and the context reads plainly. The old purple wash on a full
 * width band drew more attention than a hunk boundary deserves.
 */
export function HunkHeader({ header, first = false }: { header: string; first?: boolean }) {
  const match = /^(@@[^@]*@@)\s*(.*)$/.exec(header);
  const range = match?.[1] ?? header;
  const context = match?.[2] ?? '';

  return (
    <div
      className={`flex items-center gap-3 py-1 pr-4 font-mono text-xs ${first ? '' : 'border-t border-ink/[0.06]'}`}
      style={{ paddingLeft: '100px' }}
    >
      <span className="shrink-0 text-ink/25">{range}</span>
      {context && <span className="truncate text-ink/45">{context}</span>}
    </div>
  );
}

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut + 1);
}

function basename(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
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
