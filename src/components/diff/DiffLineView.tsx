import { memo, type ReactNode } from 'react';
import type { DiffLine } from '../../types';
import type { ThemedToken } from '../../utils/syntaxHighlight';
import type { WordHighlight } from '../../utils/wordDiff';
import { Icon } from '../terminal/Icon';
import { anchorForLine, type DiffLineAnchor } from './diffAnchor';

export { anchorForLine };
export type { DiffLineAnchor };

export interface DiffLineViewProps {
  line: DiffLine;
  tokens: ThemedToken[] | null;
  wordHighlight?: WordHighlight;
  /** Where a comment on this line would attach, or null if nowhere. */
  anchor?: DiffLineAnchor | null;
  /** When set, the hovered line offers a button that starts a comment here. */
  onAddComment?: (anchor: DiffLineAnchor) => void;
  /**
   * Whether this is the line the pointer is on.
   *
   * The comment button used to be rendered on every line and revealed with a
   * CSS hover rule — one button and one icon per line, of which at most one is
   * ever visible. On a large diff that was tens of thousands of nodes, and an
   * `Icon` re-parses its source on each render. The parent tracks the hovered
   * line instead and only that line builds the button.
   */
  showComment?: boolean;
  /** Position within the hunk, reported back on hover. */
  index?: number;
  onHover?: (index: number) => void;
}

export const DiffLineView = memo(function DiffLineView({
  line,
  tokens,
  wordHighlight,
  anchor,
  onAddComment,
  showComment,
  index,
  onHover,
}: DiffLineViewProps) {
  const lineBg =
    line.type === 'addition' ? 'bg-diff-added/10' : line.type === 'deletion' ? 'bg-diff-removed/[0.08]' : '';
  const gutterBg =
    line.type === 'addition'
      ? 'bg-diff-added/[0.12]'
      : line.type === 'deletion'
        ? 'bg-diff-removed/10'
        : 'bg-terminal-inset';
  const prefixColor =
    line.type === 'addition' ? 'text-diff-added' : line.type === 'deletion' ? 'text-diff-removed' : 'text-transparent';
  const wordBg =
    line.type === 'addition'
      ? 'color-mix(in srgb, var(--color-diff-added) 25%, transparent)'
      : line.type === 'deletion'
        ? 'color-mix(in srgb, var(--color-diff-removed) 22%, transparent)'
        : undefined;

  const commentable = showComment && anchor && onAddComment;

  return (
    <div
      className={`relative flex font-mono text-sm leading-normal ${lineBg}`}
      onMouseEnter={onHover && index != null ? () => onHover(index) : undefined}
    >
      {/* One rule at the edge of the gutter, not one between the two number
          columns as well. Two hairlines running the height of every diff was
          the single noisiest thing on the page. */}
      <span className={`flex shrink-0 select-none sticky left-0 z-[1] ${gutterBg} border-r border-ink/[0.07]`}>
        <span className="w-[44px] px-2 text-right text-ink/25">{line.oldLineNo ?? ''}</span>
        <span className="relative w-[44px] px-2 text-right text-ink/25">
          {line.newLineNo ?? ''}
          {commentable && (
            <button
              type="button"
              title="Comment on this line"
              className="absolute right-[-9px] top-1/2 -translate-y-1/2 z-[2] w-[18px] h-[18px] rounded bg-accent text-accent-ink flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
              onClick={(e) => {
                e.stopPropagation();
                onAddComment(anchor);
              }}
            >
              <Icon name="plus" />
            </button>
          )}
        </span>
      </span>
      <span className="flex-1 pl-2 pr-12 whitespace-pre-wrap break-words">
        <span className={`inline-block w-4 select-none ${prefixColor}`}>
          {line.type === 'context' ? ' ' : line.type === 'addition' ? '+' : '-'}
        </span>
        {tokens
          ? renderTokensWithHighlights(tokens, wordHighlight, wordBg)
          : renderPlainWithHighlights(line.content, wordHighlight, wordBg)}
      </span>
    </div>
  );
});

/** Render syntax tokens, splitting them at word-highlight boundaries */
export function renderTokensWithHighlights(
  tokens: ThemedToken[],
  wordHighlight: WordHighlight | undefined,
  wordBg: string | undefined,
): ReactNode[] {
  if (!wordHighlight || wordHighlight.ranges.length === 0 || !wordBg) {
    return tokens.map((token, i) => (
      <span key={i} style={token.color ? { color: token.color } : undefined}>
        {token.content}
      </span>
    ));
  }

  const elements: ReactNode[] = [];
  let charPos = 0;
  let rangeIdx = 0;
  const ranges = wordHighlight.ranges;

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti];
    const tokenStart = charPos;
    const tokenEnd = charPos + token.content.length;
    const baseStyle: React.CSSProperties = token.color ? { color: token.color } : {};

    // Check if this token overlaps any highlight range
    let hasOverlap = false;
    for (let r = rangeIdx; r < ranges.length && ranges[r][0] < tokenEnd; r++) {
      if (ranges[r][1] > tokenStart) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      elements.push(
        <span key={`${ti}`} style={baseStyle}>
          {token.content}
        </span>,
      );
    } else {
      // Split token at highlight boundaries
      let pos = 0;
      let partIdx = 0;
      while (pos < token.content.length) {
        const absPos = tokenStart + pos;
        // Find the next relevant range
        while (rangeIdx < ranges.length && ranges[rangeIdx][1] <= absPos) rangeIdx++;

        if (rangeIdx < ranges.length && ranges[rangeIdx][0] <= absPos) {
          // Inside a highlight range
          const end = Math.min(token.content.length, ranges[rangeIdx][1] - tokenStart);
          elements.push(
            <span key={`${ti}-${partIdx++}`} style={{ ...baseStyle, backgroundColor: wordBg, borderRadius: '2px' }}>
              {token.content.slice(pos, end)}
            </span>,
          );
          pos = end;
        } else {
          // Before the next highlight range
          const nextRangeStart = rangeIdx < ranges.length ? ranges[rangeIdx][0] - tokenStart : token.content.length;
          const end = Math.min(token.content.length, nextRangeStart);
          elements.push(
            <span key={`${ti}-${partIdx++}`} style={baseStyle}>
              {token.content.slice(pos, end)}
            </span>,
          );
          pos = end;
        }
      }
    }

    charPos = tokenEnd;
  }

  return elements;
}

/** Render plain text content with word-highlight backgrounds */
export function renderPlainWithHighlights(
  content: string,
  wordHighlight: WordHighlight | undefined,
  wordBg: string | undefined,
): ReactNode {
  if (!wordHighlight || wordHighlight.ranges.length === 0 || !wordBg) {
    return <span className="text-diff-fg">{content}</span>;
  }

  const elements: ReactNode[] = [];
  let pos = 0;

  for (const [start, end] of wordHighlight.ranges) {
    if (start > pos) {
      elements.push(
        <span key={pos} className="text-diff-fg">
          {content.slice(pos, start)}
        </span>,
      );
    }
    elements.push(
      <span key={start} className="text-diff-fg" style={{ backgroundColor: wordBg, borderRadius: '2px' }}>
        {content.slice(start, end)}
      </span>,
    );
    pos = end;
  }

  if (pos < content.length) {
    elements.push(
      <span key={pos} className="text-diff-fg">
        {content.slice(pos)}
      </span>,
    );
  }

  return elements;
}
