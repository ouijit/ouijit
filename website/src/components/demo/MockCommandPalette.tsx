import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { StatusDot } from '../../ouijit-ui/components/terminal/StatusDot';
import { fuzzyMatch, type MatchRange } from '../../ouijit-ui/utils/fuzzyMatch';
import { featuresTasks, featuresTerminalsByTask } from './featuresFixtures';
import { PaletteBranchRow, PaletteFooter, PaletteGroupTitle, PaletteRow } from './paletteParts';

/**
 * The command palette over the hero window, typeable. The app portals it to
 * the body as a fixed overlay; here it is absolute inside the window, which
 * is on a scale transform a fixed child would ignore. `.app-window-overlay`
 * carries that, since the window's bevel overrides positioning utilities on
 * its children.
 *
 * Ranking is the app's own fuzzyMatch over the title. Frecency, the branch and
 * tag fields, and the group caps are not modelled — with a dozen fixture rows
 * there is nothing for them to do.
 */

const PROJECT = { name: 'horizon', path: '~/Code/horizon' };

const STATUS_LABEL: Record<string, string> = {
  todo: 'to do',
  in_progress: 'in progress',
  in_review: 'in review',
  done: 'done',
};

const PULLS = [
  { number: 486, title: 'Speed up search index build', meta: 'yours' },
  { number: 482, title: 'Refactor billing webhook router', meta: 'needs review' },
  { number: 488, title: 'Add rate limiting to the public API', meta: 'needs review' },
];

interface Item {
  key: string;
  kind: 'terminal' | 'project' | 'task' | 'pull';
  title: string;
  context: string;
  meta?: string;
  action: string;
  hint?: string;
  leading: ReactNode;
  children?: { key: string; title: string; summaryType: string }[];
}

const TERMINALS = Object.values(featuresTerminalsByTask).flat();

const ITEMS: Item[] = [
  ...TERMINALS.map(
    (t): Item => ({
      key: t.ptyId,
      kind: 'terminal',
      title: t.label ?? t.ptyId,
      /* Two terminals in one task carry the same name, so the name alone
         cannot tell them apart. What each is doing can. */
      hint: t.lastOscTitle ?? undefined,
      context: PROJECT.name,
      action: 'Focus terminal',
      leading: <StatusDot summaryType={t.summaryType} />,
    }),
  ),
  {
    key: 'project-horizon',
    kind: 'project',
    title: PROJECT.name,
    context: PROJECT.path,
    action: 'Open project',
    leading: (
      <span className="w-4 h-4 overflow-hidden rounded-[4px] flex items-center justify-center text-[8px] font-bold text-white bg-[#e9679f]">
        HO
      </span>
    ),
  },
  ...featuresTasks.map(
    (task): Item => ({
      key: `task-${task.taskNumber}`,
      kind: 'task',
      title: task.name,
      context: PROJECT.name,
      meta: `${STATUS_LABEL[task.status]} · 2h`,
      action: 'Open task',
      leading: <span className="font-mono text-[11px] text-text-tertiary tabular-nums">T-{task.taskNumber}</span>,
      /* What the shell is doing, not its name: the name is the task's own,
         so a row that showed it would repeat the line above it. This is the
         rule the kanban card's connected rows already follow. */
      children: (featuresTerminalsByTask[task.taskNumber] ?? []).map((t) => ({
        key: t.ptyId,
        title: t.lastOscTitle || t.label,
        summaryType: t.summaryType,
      })),
    }),
  ),
  ...PULLS.map(
    (pr): Item => ({
      key: `pull-${pr.number}`,
      kind: 'pull',
      title: pr.title,
      context: PROJECT.name,
      meta: pr.meta,
      action: 'Open pull request',
      leading: <span className="font-mono text-[11px] text-text-tertiary tabular-nums">#{pr.number}</span>,
    }),
  ),
];

const GROUPS: { kind: Item['kind']; title: string }[] = [
  { kind: 'terminal', title: 'Terminals' },
  { kind: 'project', title: 'Projects' },
  { kind: 'task', title: 'Tasks' },
  { kind: 'pull', title: 'Pull requests' },
];

function highlight(text: string, ranges: MatchRange[] | undefined): ReactNode {
  if (!ranges || ranges.length === 0) return text;
  const parts: ReactNode[] = [];
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

/** One selectable line: a result, or a shell hanging off the result above it. */
interface Row {
  key: string;
  item: Item;
  child?: { key: string; title: string; summaryType: string };
  last?: boolean;
  ranges?: MatchRange[];
}

export function MockCommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  // Set by the keys, cleared by a move: without it the row under a resting
  // cursor steals the selection back on the scroll an arrow key causes.
  const pointerLive = useRef(true);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const groups = useMemo(() => {
    const withChildren = (items: { item: Item; ranges?: MatchRange[] }[]): Row[] =>
      items.flatMap(({ item, ranges }) => [
        { key: item.key, item, ranges },
        ...(item.children ?? []).map((child, i) => ({
          key: child.key,
          item,
          child,
          last: i === item.children!.length - 1,
        })),
      ]);

    if (query.trim()) {
      const ranked = ITEMS.map((item) => ({ item, hit: fuzzyMatch(query.trim(), item.title) }))
        .filter((entry) => entry.hit)
        .sort((a, b) => b.hit!.score - a.hit!.score)
        .map(({ item, hit }) => ({ item, ranges: hit!.ranges }));
      return [{ title: null, rows: withChildren(ranked) }];
    }

    return GROUPS.map(({ kind, title }) => ({
      title,
      rows: withChildren(ITEMS.filter((item) => item.kind === kind).map((item) => ({ item }))),
    })).filter((g) => g.rows.length > 0);
  }, [query]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const cursor = Math.min(selected, Math.max(0, flat.length - 1));
  const action = flat[cursor]?.child ? 'Focus terminal' : flat[cursor]?.item.action;

  let index = -1;
  return (
    <div
      className="app-window-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass-bevel relative w-full max-w-[40rem] max-h-full flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden"
        style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') return onClose();
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          pointerLive.current = false;
          const step = e.key === 'ArrowDown' ? 1 : -1;
          setSelected((c) => (flat.length === 0 ? 0 : (c + step + flat.length) % flat.length));
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/[0.06] shrink-0">
          <span className="shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
            <Icon name="magnifying-glass" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a terminal, project or task"
            spellCheck={false}
            aria-label="Search terminals, projects and tasks"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </div>

        {flat.length === 0 ? (
          <div className="px-4 py-10 flex flex-col items-center gap-1.5">
            <span className="text-xs text-text-secondary">No matches</span>
            <span className="text-[11px] text-text-tertiary text-center">
              Nothing in your terminals, projects or tasks matches “{query}”.
            </span>
          </div>
        ) : (
          <div
            className="flex-1 min-h-0 overflow-y-auto settings-scrollable pb-1"
            style={flat.length >= 9 ? { height: '22rem' } : undefined}
            onMouseMove={() => (pointerLive.current = true)}
          >
            {groups.map((group) => (
              <div key={group.title ?? 'results'}>
                {group.title && <PaletteGroupTitle>{group.title}</PaletteGroupTitle>}
                {group.rows.map((row) => {
                  index++;
                  const at = index;
                  const on = at === cursor;
                  const hover = () => pointerLive.current && setSelected(at);
                  return row.child ? (
                    <PaletteBranchRow
                      key={row.key}
                      title={row.child.title}
                      summaryType={row.child.summaryType}
                      last={!!row.last}
                      selected={on}
                      rowRef={on ? selectedRef : undefined}
                      onHover={hover}
                    />
                  ) : (
                    <PaletteRow
                      key={row.key}
                      leading={row.item.leading}
                      title={highlight(row.item.title, row.ranges)}
                      hint={row.item.hint}
                      context={row.item.context}
                      meta={row.item.meta}
                      selected={on}
                      rowRef={on ? selectedRef : undefined}
                      onHover={hover}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <PaletteFooter action={action} />
      </div>
    </div>
  );
}
