import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FileDiff, DiffHunk } from '../../types';
import type { HunkTokens } from '../../utils/syntaxHighlight';
import { computeWordHighlights } from '../../utils/wordDiff';
import { useSyntaxHighlight } from './useSyntaxHighlight';
import { DiffLineView, anchorForLine, type DiffLineAnchor } from './DiffLineView';
import { anchorForRange } from '../../diffAnchor';
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
  /**
   * Content anchored under a specific line — review threads, drafts, notes.
   *
   * Takes the path, like `onAddComment`, so a caller can hold one callback for
   * the whole diff. Binding it per file in the caller's render would hand every
   * file a new function each time and no memoized line below would ever bail.
   */
  renderBelowLine?: (path: string, anchor: DiffLineAnchor) => ReactNode;
  onAddComment?: (path: string, anchor: DiffLineAnchor) => void;
  /**
   * Whether a comment covers this line without rendering on it.
   *
   * Takes the path for the reason `renderBelowLine` does. Withheld when nothing
   * is marked: it is asked once per line of the diff.
   */
  markLine?: (path: string, anchor: DiffLineAnchor) => boolean;
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
  collapsed?: boolean;
  /** Enables the fold control. Takes the path for the same reason `renderBelowLine` does. */
  onCollapsedChange?: (path: string, collapsed: boolean) => void;
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
  markLine,
  headerRight,
  binaryView,
  loadingLabel = 'Loading...',
  emptyLabel = 'No diff available',
  failedLabel = 'Could not read this file',
  collapsed,
  onCollapsedChange,
  collapseLabel = 'Collapse',
}: DiffFileSectionProps) {
  // Nothing below the header is rendered while it is folded, so a file already
  // dealt with costs one row of the scroll rather than its whole diff.
  const tokens = useSyntaxHighlight(collapsed ? undefined : diff, path);

  // One closure for the file rather than one per line. A new function per line
  // per render is what stops a memoized line from ever bailing out.
  const addComment = useCallback((anchor: DiffLineAnchor) => onAddComment?.(path, anchor), [onAddComment, path]);
  const belowLine = useCallback((anchor: DiffLineAnchor) => renderBelowLine?.(path, anchor), [renderBelowLine, path]);
  const lineMarked = useCallback((anchor: DiffLineAnchor) => markLine?.(path, anchor) ?? false, [markLine, path]);
  const setCollapsed = useCallback((next: boolean) => onCollapsedChange?.(path, next), [onCollapsedChange, path]);

  return (
    /* `overflow: clip` rather than `hidden`: clip rounds the corners without
       becoming a scroll container, which would strand the sticky header below
       inside its own box instead of pinning it to the pane. */
    <div className="diff-card mx-6 rounded-[14px] border border-bezel bg-diff-card overflow-clip" data-path={path}>
      <div className="pane-ledge sticky top-0 z-10 flex items-center gap-2 px-4 h-9 bg-terminal-surface">
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
            onClick={() => setCollapsed(!collapsed)}
          >
            <Icon name="check" />
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
          // `null` is a diff git could not produce, which is not the same as one
          // that has not arrived yet.
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
                  renderBelowLine={renderBelowLine ? belowLine : undefined}
                  markLine={markLine ? lineMarked : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/** Splits `@@ -12,7 +12,10 @@ export function readToken()` into range and context. */
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
  markLine?: (anchor: DiffLineAnchor) => boolean;
}

export const DiffHunkView = memo(function DiffHunkView({
  hunk,
  hunkTokens,
  renderBelowLine,
  onAddComment,
  markLine,
}: DiffHunkViewProps) {
  const wordHighlights = useMemo(() => computeWordHighlights(hunk.lines), [hunk.lines]);
  const anchors = useMemo(() => hunk.lines.map(anchorForLine), [hunk.lines]);
  const [hovered, setHovered] = useState(-1);
  // The run being dragged out, as indices into this hunk. A comment may cover
  // several lines but not a gap between hunks: the lines either side of one are
  // not adjacent in the file, whatever the diff makes them look like.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  const onHover = useCallback((index: number) => {
    setHovered((current) => (current === index ? current : index));
    setDrag((current) => (current && current.to !== index ? { ...current, to: index } : current));
  }, []);

  const startSelect = useCallback((index: number) => setDrag({ from: index, to: index }), []);

  // The release ends the drag wherever it happens — a pointer that has left the
  // hunk, or the window, still let go of a selection that has to be resolved.
  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      setDrag(null);
      const anchor = anchorForRange(hunk.lines, drag.from, drag.to);
      if (anchor) onAddComment?.(anchor);
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, [drag, hunk.lines, onAddComment]);

  const selection = drag && { lo: Math.min(drag.from, drag.to), hi: Math.max(drag.from, drag.to) };

  return (
    <div
      onMouseLeave={onAddComment ? () => setHovered(-1) : undefined}
      // A hunk off screen holds nothing that has to be laid out, so the browser
      // is told it may skip one — otherwise every line in the pull request is
      // laid out on each scroll. `auto` on the intrinsic size means the estimate
      // is used only until the hunk has been measured once for real.
      //
      // A drag across lines is a range, not a text selection; without the second
      // the browser paints one over the diff as the pointer moves.
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${estimateHunkHeight(hunk)}px`,
        ...(drag ? { userSelect: 'none' as const } : {}),
      }}
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
              onStartSelect={onAddComment ? startSelect : undefined}
              showComment={onAddComment ? hovered === i && !drag : false}
              selected={selection ? i >= selection.lo && i <= selection.hi : false}
              marked={anchor && markLine ? markLine(anchor) : false}
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
