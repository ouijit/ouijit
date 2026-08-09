import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import type { FileDiff, DiffHunk } from '../../types';
import type { HunkTokens } from '../../utils/syntaxHighlight';
import { computeWordHighlights } from '../../utils/wordDiff';
import { useSyntaxHighlight } from './useSyntaxHighlight';
import { DiffLineView, anchorForLine, type DiffLineAnchor } from './DiffLineView';
import { estimateHunkHeight } from './diffMetrics';
import { badgeColorClass, statusLabel, type DiffFileStatus } from './diffStatus';
import { Icon } from '../terminal/Icon';

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
  /** `undefined` while it loads, `null` when it could not be produced. */
  diff: FileDiff | null | undefined;
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
  failedLabel?: string;
  /** Folded to its header alone. */
  collapsed?: boolean;
  /** Enables the fold control in the header. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** What the control means here — "Viewed" in a review, "Collapse" outside one. */
  collapseLabel?: string;
}

export const DiffFileSection = memo(function DiffFileSection({
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
  failedLabel = 'Could not read this file',
  collapsed,
  onCollapsedChange,
  collapseLabel = 'Collapse',
}: DiffFileSectionProps) {
  // Nothing below the header exists while it is folded, so a file already dealt
  // with costs one row of the scroll rather than its whole diff — which is the
  // point of folding it.
  const tokens = useSyntaxHighlight(collapsed ? undefined : diff, path);

  // One closure for the file rather than one per line. A new function per line
  // per render is what stops a memoized line from ever bailing out.
  const addComment = useCallback((anchor: DiffLineAnchor) => onAddComment?.(path, anchor), [onAddComment, path]);

  return (
    <div className="last:border-b-0" data-path={path}>
      {/* The directory is context and the filename is the subject, so they are
          not set at the same weight.

          It pins below whatever else has claimed the top of the pane — a lens
          publishes the height of the part header above it — and to the top
          itself when nothing has, which is every other diff in the app. */}
      <div
        className="pane-ledge sticky z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface"
        style={{ top: 'var(--diff-sticky-offset, 0px)' }}
      >
        {onCollapsedChange && (
          <button
            type="button"
            title={collapsed ? `${collapseLabel} — click to unfold` : collapseLabel}
            aria-label={collapseLabel}
            aria-pressed={Boolean(collapsed)}
            className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors duration-150 [&>svg]:w-3 [&>svg]:h-3 ${
              collapsed
                ? 'bg-accent border-accent text-accent-ink'
                : 'border-ink/25 text-transparent hover:border-ink/50'
            }`}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <Icon name="check-circle" />
          </button>
        )}
        <span className={`flex-1 min-w-0 truncate font-mono text-[13px] ${collapsed ? 'opacity-45' : ''}`} title={path}>
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
        {collapsed ? null : diff === undefined ? (
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">
            {loadingLabel}
          </div>
        ) : diff === null ? (
          // Distinct from loading: a file whose diff git could not produce used
          // to sit on "Loading..." for as long as the pane stayed open.
          <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary gap-2">{failedLabel}</div>
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
                  onAddComment={onAddComment ? addComment : undefined}
                  renderBelowLine={renderBelowLine}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

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
  renderBelowLine?: (anchor: DiffLineAnchor) => ReactNode;
  /** Already bound to the file — one closure for the hunk, not one per line. */
  onAddComment?: (anchor: DiffLineAnchor) => void;
}

export const DiffHunkView = memo(function DiffHunkView({
  hunk,
  hunkTokens,
  renderBelowLine,
  onAddComment,
}: DiffHunkViewProps) {
  const wordHighlights = useMemo(() => computeWordHighlights(hunk.lines), [hunk.lines]);
  const anchors = useMemo(() => hunk.lines.map(anchorForLine), [hunk.lines]);
  const [hovered, setHovered] = useState(-1);

  const onHover = useCallback((index: number) => {
    setHovered((current) => (current === index ? current : index));
  }, []);

  return (
    <div
      onMouseLeave={onAddComment ? () => setHovered(-1) : undefined}
      // A hunk holds nothing that has to be laid out while it is off screen, so
      // the browser is told it may skip one entirely — the difference between
      // paying for every line in the pull request on each scroll and paying for
      // the ones being read. `auto` on the intrinsic size means the estimate is
      // only used until the hunk has been measured once for real.
      style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${estimateHunkHeight(hunk)}px` }}
    >
      {hunk.lines.map((line, i) => {
        const anchor = anchors[i];
        const below = anchor && renderBelowLine ? renderBelowLine(anchor) : null;
        return (
          <div key={i}>
            <DiffLineView
              line={line}
              tokens={hunkTokens?.[i] ?? null}
              wordHighlight={wordHighlights.get(i)}
              anchor={anchor}
              onAddComment={onAddComment}
              showComment={onAddComment ? hovered === i : false}
              index={i}
              onHover={onAddComment ? onHover : undefined}
            />
            {below}
          </div>
        );
      })}
    </div>
  );
});
