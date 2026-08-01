/**
 * One switcher result.
 *
 * Single line, fixed height. Rows used to stack a title over a subtitle, which
 * at a dozen results filled the panel with more text than could be scanned; the
 * supporting detail is now inline and dim, and the row's leading glyph carries
 * the type. That last part matters most — previously a terminal, a project and
 * a task in the same project all rendered the same colored initials tile, so
 * the icon column told you nothing.
 *
 * Highlighting follows the field that actually matched. A row surfaced by its
 * branch or its tag shows that text, highlighted, instead of leaving the user
 * to guess why a row with no visible match is in the list.
 */

import { projectIconColor, getInitials } from '../../utils/projectIcon';
import type { FieldMatch } from '../../utils/paletteScore';
import type { MatchRange } from '../../utils/fuzzyMatch';
import { Icon } from '../terminal/Icon';
import { StatusDot } from '../terminal/StatusDot';
import { KIND_CHIP, type PaletteItem } from './paletteItems';

/** Fields whose match is shown on the title rather than as a separate hint. */
const TITLE_FIELDS = new Set(['name', 'label', 'number']);
/** Fields already rendered as the row's context text. */
const CONTEXT_FIELDS = new Set(['project', 'path']);

/** Split text into matched and unmatched runs. */
function highlight(text: string, ranges: MatchRange[] | undefined): React.ReactNode {
  if (!ranges || ranges.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span key={i} className="text-accent font-semibold">
        {text.slice(start, end)}
      </span>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export interface PaletteRowProps {
  item: PaletteItem;
  /** The winning field, when a query produced one. */
  match: FieldMatch | null;
  selected: boolean;
  /** Type tag on the right. On in the flat ranked list, off under group headers. */
  showKind: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onHover: () => void;
  onClick: () => void;
}

export function PaletteRow({ item, match, selected, showKind, rowRef, onHover, onClick }: PaletteRowProps) {
  const matchKey = match?.key;
  const titleRanges = matchKey && TITLE_FIELDS.has(matchKey) ? match?.ranges : undefined;
  const contextRanges = matchKey && CONTEXT_FIELDS.has(matchKey) ? match?.ranges : undefined;
  const hint = match && !TITLE_FIELDS.has(match.key) && !CONTEXT_FIELDS.has(match.key) ? match : null;

  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={selected}
      data-testid="palette-row"
      onMouseMove={onHover}
      onClick={onClick}
      className="flex items-center gap-2.5 h-9 px-3 cursor-default transition-colors duration-100 ease-out [-webkit-app-region:no-drag] [scroll-margin-block:2rem]"
      style={{
        background: selected ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : undefined,
        ...(selected && { boxShadow: 'inset 2px 0 0 0 var(--color-accent)' }),
      }}
    >
      <span className="w-4 shrink-0 flex items-center justify-center">
        <Leading item={item} />
      </span>

      {item.taskNumber != null && (
        <span className="font-mono text-[11px] text-text-tertiary tabular-nums shrink-0">T-{item.taskNumber}</span>
      )}

      <span className={`text-[13px] truncate shrink ${item.dimmed ? 'text-text-tertiary' : 'text-text-primary'}`}>
        {highlight(item.title, titleRanges)}
      </span>

      {item.kind !== 'project' && item.project && (
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-[2px] shrink-0"
          style={{ backgroundColor: projectIconColor(item.project) }}
        />
      )}
      <span className="text-[11px] text-text-tertiary truncate shrink min-w-0">
        {highlight(item.context, contextRanges)}
      </span>

      {hint && (
        <span className="text-[11px] text-text-tertiary truncate shrink-0 max-w-[10rem]">
          {hint.key} <span className="text-text-secondary">{highlight(hint.text, hint.ranges)}</span>
        </span>
      )}

      <span className="flex-1" />

      {item.meta && <span className="shrink-0 text-[11px] text-text-tertiary">{item.meta}</span>}

      {showKind && (
        <span className="shrink-0 w-8 text-right font-mono text-[10px] uppercase tracking-[0.08em] text-ink/40">
          {KIND_CHIP[item.kind]}
        </span>
      )}
    </div>
  );
}

/** Type glyph. A live shell outranks the type icon — it's the more useful signal. */
function Leading({ item }: { item: PaletteItem }) {
  if (item.status)
    return <StatusDot summaryType={item.status.summaryType} sandboxProvider={item.status.sandboxProvider} />;

  if (item.kind === 'project' && item.project) {
    return (
      <span className="project-tile w-4 h-4 overflow-hidden">
        <span
          className="w-full h-full flex items-center justify-center text-[8px] font-bold text-white"
          style={{ backgroundColor: projectIconColor(item.project), textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
        >
          {getInitials(item.project.name)}
        </span>
      </span>
    );
  }

  return (
    <span className="text-ink/40 [&>svg]:w-3.5 [&>svg]:h-3.5">
      <Icon name={item.kind === 'task' ? 'kanban' : 'terminal'} />
    </span>
  );
}
