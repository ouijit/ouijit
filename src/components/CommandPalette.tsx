/**
 * Mod+K switcher.
 *
 * Searches the three things you navigate between — live terminals, projects and
 * tasks — and jumps to one. Everything it can reach already exists in a store or
 * behind one IPC call, so opening it costs a `getActiveSessions` round trip and
 * a background task-cache refresh.
 *
 * It is a switcher, not a launcher: nothing here creates a worktree, changes a
 * task's status or runs a hook.
 *
 * Two layouts, chosen by whether there's a query:
 *
 *   query   one flat, globally ranked list. Grouping by type meant the first
 *           row was always the best *terminal*, so Enter regularly opened
 *           something other than the best match. Ranked flat, the top row is
 *           the best match by construction.
 *   empty   grouped browse, led by the places you actually return to.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { scoreFields, type FieldMatch } from '../utils/paletteScore';
import { frecencyBoost, loadFrecency, persistFrecency, recordUse, type FrecencyMap } from '../utils/paletteFrecency';
import { buildPaletteItems, KIND_LABEL, type PaletteItem, type PaletteKind } from './palette/paletteItems';
import { PaletteRow } from './palette/PaletteRow';
import { Icon } from './terminal/Icon';
import type { ActiveSession } from '../types';

/** Per-group cap while browsing, so one crowded group can't bury the others. */
const GROUP_LIMIT = 8;
/** Ranked results kept for a query. Past this, refine the query. */
const QUERY_LIMIT = 40;
/** Size of the frecency-led group shown with no query. */
const RECENT_LIMIT = 6;
/** Rows the list shows before it locks its height and scrolls instead. */
const VISIBLE_ROWS = 9;
/** Fade-out duration; matches the dialog transitions. */
const EXIT_MS = 200;

const GROUP_ORDER: PaletteKind[] = ['terminal', 'project', 'task'];

type GroupKey = 'results' | 'recent' | PaletteKind;

interface RankedItem {
  item: PaletteItem;
  /** The field the query matched, or null when there's no query. */
  match: FieldMatch | null;
  score: number;
}

interface Group {
  key: GroupKey;
  /** Null renders no header — the flat ranked list. */
  title: string | null;
  rows: RankedItem[];
  /** Rows the cap is hiding. */
  hidden: number;
}

/**
 * Mount/unmount gate for the enter and exit transitions, mirroring how the
 * app's dialogs animate: paint once in the hidden state, flip visible on the
 * next frame, and hold the DOM for the length of the fade on the way out.
 * `session` keys the body so a reopen inside that window starts clean rather
 * than resurrecting the previous query.
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  // Bumped only on a closed→open transition, so the body remounts fresh on
  // reopen but never mid-session. Seeded from the initial `open` so the first
  // paint doesn't count as a transition — a bump there would remount the body
  // a frame after mount and wipe anything already typed.
  const [session, setSession] = useState(0);
  const wasOpen = useRef(open);

  useEffect(() => {
    const reopened = open && !wasOpen.current;
    wasOpen.current = open;
    if (open) {
      if (reopened) setSession((s) => s + 1);
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return <PaletteBody key={session} visible={visible} />;
}

function PaletteBody({ visible }: { visible: boolean }) {
  const projects = useAppStore((s) => s.projects);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const taskCacheByProject = useAppStore((s) => s.taskCacheByProject);
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject);
  const displayStates = useTerminalStore((s) => s.displayStates);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [frecency, setFrecency] = useState<FrecencyMap>({});
  const [expanded, setExpanded] = useState<GroupKey[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  // Written on jump, so the update doesn't have to survive a re-render that
  // won't happen — the palette is closing.
  const frecencyRef = useRef<FrecencyMap>({});
  // One timestamp per palette session: decay must not shift while it's open.
  const openedAt = useRef(Date.now()).current;

  const close = useCallback(() => useUIStore.getState().setPaletteOpen(false), []);

  // Live sessions are the authoritative terminal list — the store only holds
  // projects this renderer has hydrated. The task cache refresh reconciles in
  // the background; the palette paints from whatever is already cached.
  useEffect(() => {
    let cancelled = false;
    window.api.pty
      .getActiveSessions()
      .then((live) => {
        if (!cancelled) setSessions(live);
      })
      .catch(() => {
        /* store-backed terminals still list */
      });
    void loadFrecency().then((map) => {
      if (cancelled) return;
      frecencyRef.current = map;
      setFrecency(map);
    });
    void useAppStore.getState().loadHomeRecents();
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus before paint, not on the next frame. A deferred focus leaves a window
  // where the palette is on screen but the keystrokes still belong to whatever
  // had focus before — typically an xterm, which would eat the first characters
  // typed and the Escape that was meant to dismiss this.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape at the document level, in capture, the way the dialogs handle it —
  // dismissal must not depend on focus being somewhere in particular.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [close]);

  // Hover only claims the selection once the pointer has genuinely moved.
  // Otherwise a cursor resting over the list fights the arrow keys: scrolling
  // the selected row into view slides a new row under the pointer, whose hover
  // then yanks the selection back.
  const pointerLive = useRef(false);
  const pointerAt = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const last = pointerAt.current;
      if (last && last.x === e.clientX && last.y === e.clientY) return;
      pointerAt.current = { x: e.clientX, y: e.clientY };
      pointerLive.current = true;
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, []);

  const items = useMemo(
    () =>
      buildPaletteItems({
        projects,
        activeProjectPath,
        terminalsByProject,
        displayStates,
        sessions,
        taskCacheByProject,
      }),
    [projects, activeProjectPath, terminalsByProject, displayStates, sessions, taskCacheByProject],
  );

  const groups = useMemo<Group[]>(() => {
    if (query.length > 0) {
      const ranked: RankedItem[] = [];
      for (const item of items) {
        const match = scoreFields(query, item.fields);
        if (!match) continue;
        // The boost stays under one tier step, so what you use often reorders
        // comparable matches without ever lifting a weak match over a literal one.
        ranked.push({ item, match, score: match.score + frecencyBoost(frecency[item.key], openedAt) });
      }
      ranked.sort((a, b) => b.score - a.score || a.item.order - b.item.order);
      return [{ key: 'results', title: null, rows: ranked.slice(0, QUERY_LIMIT), hidden: 0 }];
    }

    const result: Group[] = [];
    const recentKeys = new Set<string>();
    const recent: RankedItem[] = items
      .map((item): RankedItem => ({ item, match: null, score: frecencyBoost(frecency[item.key], openedAt) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, RECENT_LIMIT);
    for (const entry of recent) recentKeys.add(entry.item.key);
    if (recent.length > 0) result.push({ key: 'recent', title: 'Recent', rows: recent, hidden: 0 });

    for (const kind of GROUP_ORDER) {
      const rows: RankedItem[] = items
        .filter((item) => item.kind === kind && !recentKeys.has(item.key))
        .map((item): RankedItem => ({ item, match: null, score: 0 }));
      if (rows.length === 0) continue;
      const limit = expanded.includes(kind) ? rows.length : GROUP_LIMIT;
      result.push({
        key: kind,
        title: KIND_LABEL[kind],
        rows: rows.slice(0, limit),
        hidden: Math.max(0, rows.length - limit),
      });
    }
    return result;
  }, [items, query, frecency, expanded, openedAt]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  // Keep the cursor in range as results change under it.
  useEffect(() => {
    setSelected((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  useEffect(() => {
    // Optional call: jsdom doesn't implement scrollIntoView.
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  // Close before running: `navigateToProject` wraps `startViewTransition`,
  // which snapshots the whole document — an overlay still mounted would be
  // captured in the outgoing frame and crossfade away.
  const activate = useCallback(
    (entry: RankedItem | undefined) => {
      if (!entry) return;
      const next = recordUse(frecencyRef.current, entry.item.key, Date.now());
      frecencyRef.current = next;
      persistFrecency(next);
      close();
      requestAnimationFrame(() => entry.item.run());
    },
    [close],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pointerLive.current = false;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSelected((current) => (flat.length === 0 ? 0 : (current + step + flat.length) % flat.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        activate(flat[selected]);
      }
    },
    [flat, selected, activate],
  );

  const action = flat[selected]?.item.action;
  let rowIndex = -1;

  return createPortal(
    <div
      data-testid="command-palette"
      data-visible={visible}
      className={`fixed inset-0 z-[10003] flex justify-center px-6 pt-[14vh] pb-10 transition-opacity duration-200 ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className={`glass-bevel w-full max-w-[40rem] max-h-full flex flex-col rounded-[14px] border border-bezel-panel overflow-hidden ${
          visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-2'
        }`}
        style={{
          background: 'var(--color-terminal-bg)',
          boxShadow: 'var(--shadow-panel)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink/[0.06] shrink-0">
          <span className="shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
            <Icon name="magnifying-glass" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Jump to a terminal, project or task"
            spellCheck={false}
            aria-label="Search terminals, projects and tasks"
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-tertiary [-webkit-app-region:no-drag]"
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
            role="listbox"
            aria-label="Results"
            className="flex-1 min-h-0 overflow-y-auto settings-scrollable py-1"
            // Locked once there's enough to scroll, so the panel stops resizing
            // under the cursor on every keystroke.
            style={flat.length >= VISIBLE_ROWS ? { height: '22rem' } : undefined}
          >
            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.title ?? 'Results'}>
                {group.title && (
                  <div
                    className="sticky top-0 z-10 px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-ink/40"
                    style={{ background: 'var(--color-terminal-bg)' }}
                  >
                    {group.title}
                  </div>
                )}
                {group.rows.map((row) => {
                  rowIndex++;
                  const isSelected = rowIndex === selected;
                  const index = rowIndex;
                  return (
                    <PaletteRow
                      key={row.item.id}
                      item={row.item}
                      match={row.match}
                      selected={isSelected}
                      showKind={group.key === 'results' || group.key === 'recent'}
                      rowRef={isSelected ? selectedRef : undefined}
                      onHover={() => {
                        if (pointerLive.current) setSelected(index);
                      }}
                      onClick={() => activate(row)}
                    />
                  );
                })}
                {group.hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((keys) => [...keys, group.key])}
                    className="w-full text-left px-3 py-1.5 bg-transparent border-none cursor-default text-[11px] text-text-tertiary hover:text-text-secondary [-webkit-app-region:no-drag]"
                  >
                    Show {group.hidden} more
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="shrink-0 flex items-center gap-4 px-3 py-2 border-t border-ink/[0.06] text-[11px] text-ink/40">
          <Hint keys="↑↓" label="Navigate" />
          {action && <Hint keys="↵" label={action} />}
          <span className="flex-1" />
          <Hint keys="esc" label="Close" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-ink/[0.06] text-text-tertiary">
        {keys}
      </kbd>
      <span className="truncate">{label}</span>
    </span>
  );
}
