/**
 * One switcher result.
 *
 * Single line, fixed height: a title stacked over a subtitle fills the panel
 * with more text than can be scanned at a dozen results, so supporting detail
 * is inline and dim. The leading glyph carries the type, which matters most —
 * a colored initials tile is the same for a terminal, a project and a task in
 * the same project, leaving the icon column saying nothing.
 *
 * Highlighting follows the field that actually matched. A row surfaced by its
 * branch or its tag shows that text, highlighted, instead of leaving the user
 * to guess why a row with no visible match is in the list.
 */

import { projectIconColor, getInitials } from '../../utils/projectIcon';
import type { FieldMatch } from '../../utils/paletteScore';
import type { MatchRange } from '../../utils/fuzzyMatch';
import { Icon } from '../terminal/Icon';
import { StatusDot, sandboxSuffix } from '../terminal/StatusDot';
import { type PaletteItem } from './paletteItems';

/** Fields whose match is shown on the title rather than as a separate hint. */
const TITLE_FIELDS = new Set(['name', 'label', 'number']);
/** Fields already rendered as the row's context text. */
const CONTEXT_FIELDS = new Set(['project', 'path']);

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
  match: FieldMatch | null;
  selected: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onHover: () => void;
  onClick: () => void;
}

export function PaletteRow({ item, match, selected, rowRef, onHover, onClick }: PaletteRowProps) {
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
      className={`flex items-center gap-2.5 px-3 cursor-default transition-colors duration-100 ease-out [-webkit-app-region:no-drag] [scroll-margin-block:2rem] ${
        item.branch ? 'h-6' : 'h-9'
      }`}
      style={{
        background: selected ? 'color-mix(in srgb, var(--color-accent) 14%, transparent)' : undefined,
        ...(selected && { boxShadow: 'inset 2px 0 0 0 var(--color-accent)' }),
      }}
    >
      {item.branch ? (
        <BranchLabel item={item} />
      ) : (
        <>
          <span className="w-12 shrink-0 flex items-center">
            <Leading item={item} />
          </span>

          <span className="flex-1 min-w-0 flex items-center gap-2">
            <span className={`text-[13px] truncate ${item.dimmed ? 'text-text-tertiary' : 'text-text-primary'}`}>
              {highlight(item.title, titleRanges)}
            </span>
            {hint && (
              <span className="text-[11px] text-text-tertiary truncate shrink-0 max-w-[9rem]">
                {hint.key} <span className="text-text-secondary">{highlight(hint.text, hint.ranges)}</span>
              </span>
            )}
          </span>

          <span className="w-32 shrink-0 text-[11px] text-text-tertiary truncate">
            {highlight(item.context, contextRanges)}
          </span>

          <span className="w-28 shrink-0 text-right text-[11px] text-text-tertiary truncate">{item.meta}</span>
        </>
      )}
    </div>
  );
}

/**
 * A task's shell, drawn as a branch off its row. Same corner glyphs, dot and
 * mono label the kanban card uses, so a task reads the same in both places.
 */
function BranchLabel({ item }: { item: PaletteItem }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0 pl-3">
      <span className="font-mono text-sm leading-none text-text-secondary shrink-0 select-none opacity-40">
        {item.branch === 'last' ? '└─' : '├─'}
      </span>
      {item.status && <StatusDot summaryType={item.status.summaryType} sandboxProvider={item.status.sandboxProvider} />}
      <span className="font-mono text-[10px] leading-tight text-text-secondary truncate min-w-0">
        {item.title}
        {sandboxSuffix(item.status?.sandboxProvider)}
      </span>
    </span>
  );
}

/**
 * Leading column: tasks and pull requests lead with their number, which is what
 * gets typed; everything else leads with a glyph.
 */
function Leading({ item }: { item: PaletteItem }) {
  if (item.taskNumber != null && item.kind === 'task') {
    return <span className="font-mono text-[11px] text-text-tertiary tabular-nums">T-{item.taskNumber}</span>;
  }

  if (item.kind === 'pull' && item.prNumber != null) {
    return <span className="font-mono text-[11px] text-text-tertiary tabular-nums">#{item.prNumber}</span>;
  }

  if (item.status) {
    return <StatusDot summaryType={item.status.summaryType} sandboxProvider={item.status.sandboxProvider} />;
  }

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
