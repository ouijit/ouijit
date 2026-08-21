import { memo, type ReactNode } from 'react';
import type { DiffLine } from '../../types';
import type { ThemedToken } from '../../utils/syntaxHighlight';
import type { WordHighlight } from '../../utils/wordDiff';
import { Icon } from '../terminal/Icon';
import { anchorForLine, type DiffLineAnchor } from '../../diffAnchor';

export { anchorForLine };
export type { DiffLineAnchor };

export interface DiffLineViewProps {
  line: DiffLine;
  tokens: ThemedToken[] | null;
  wordHighlight?: WordHighlight;
  /** Where a comment on this line would attach, or null if nowhere. */
  anchor?: DiffLineAnchor | null;
  /**
   * Reports where a comment drag began; the hunk owns the rest of the gesture.
   * Takes the index so the hunk can hold one closure rather than one per line.
   */
  onStartSelect?: (index: number) => void;
  /**
   * Whether the pointer is on this line, so only it builds the comment button.
   * A CSS hover rule instead would mean a button and an `Icon` in every line of
   * the diff, for the one that is ever visible.
   */
  showComment?: boolean;
  /** Within the run of lines a comment is being dragged across. */
  selected?: boolean;
  /**
   * Covered by a multi-line comment. The comment renders under the range's last
   * line, so the mark is all that shows how far back it reaches.
   */
  marked?: boolean;
  /** Position within the hunk, reported back on hover. */
  index?: number;
  onHover?: (index: number) => void;
}

export const DiffLineView = memo(function DiffLineView({
  line,
  tokens,
  wordHighlight,
  anchor,
  onStartSelect,
  showComment,
  selected,
  marked,
  index,
  onHover,
}: DiffLineViewProps) {
  const lineBg =
    line.type === 'addition' ? 'bg-diff-added/10' : line.type === 'deletion' ? 'bg-diff-removed/[0.08]' : '';
  // A commented range tints the gutter, not the source: a wash over the source
  // would hide the added/removed colour on every line it covered.
  const gutterBg = marked
    ? 'bg-accent/[0.18]'
    : line.type === 'addition'
      ? 'bg-diff-added/[0.12]'
      : line.type === 'deletion'
        ? 'bg-diff-removed/10'
        : 'bg-terminal-inset';
  const numberColor = marked ? 'text-accent' : 'text-ink/25';
  const prefixColor =
    line.type === 'addition' ? 'text-diff-added' : line.type === 'deletion' ? 'text-diff-removed' : 'text-transparent';
  const wordBg =
    line.type === 'addition'
      ? 'color-mix(in srgb, var(--color-diff-added) 25%, transparent)'
      : line.type === 'deletion'
        ? 'color-mix(in srgb, var(--color-diff-removed) 22%, transparent)'
        : undefined;

  const commentable = showComment && anchor && onStartSelect && index != null;

  return (
    <div
      className={`relative flex font-mono text-sm leading-normal ${selected ? 'bg-accent/[0.14]' : lineBg}`}
      onMouseEnter={onHover && index != null ? () => onHover(index) : undefined}
    >
      <span className={`flex shrink-0 select-none sticky left-0 z-[1] ${gutterBg} border-r border-ink/[0.07]`}>
        <span className={`w-[44px] px-2 text-right ${numberColor}`}>{line.oldLineNo ?? ''}</span>
        <span className={`relative w-[44px] px-2 text-right ${numberColor}`}>
          {line.newLineNo ?? ''}
          {commentable && (
            <button
              type="button"
              title="Comment here, or drag over the lines it is about"
              className="absolute right-[-9px] top-1/2 -translate-y-1/2 z-[2] w-[18px] h-[18px] rounded bg-accent text-accent-ink flex items-center justify-center [&>svg]:w-3 [&>svg]:h-3"
              onMouseDown={(e) => {
                e.stopPropagation();
                // Or the press begins a text selection across the diff instead.
                e.preventDefault();
                onStartSelect(index);
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
      let pos = 0;
      let partIdx = 0;
      while (pos < token.content.length) {
        const absPos = tokenStart + pos;
        while (rangeIdx < ranges.length && ranges[rangeIdx][1] <= absPos) rangeIdx++;

        if (rangeIdx < ranges.length && ranges[rangeIdx][0] <= absPos) {
          const end = Math.min(token.content.length, ranges[rangeIdx][1] - tokenStart);
          elements.push(
            <span key={`${ti}-${partIdx++}`} style={{ ...baseStyle, backgroundColor: wordBg, borderRadius: '2px' }}>
              {token.content.slice(pos, end)}
            </span>,
          );
          pos = end;
        } else {
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
