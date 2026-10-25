import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { latestPointer, usePointerStore, type Pointer } from '../../stores/pointerStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { Icon } from '../terminal/Icon';
import { anchorChain, describeTarget, hasOwnRow, targetAlive, type PointWorld } from './pointKeys';
import { findAnchor } from './pointAnchors';
import { followPointer } from './followPointer';
import { AskRunDialog } from './AskRunDialog';

const isMac = navigator.platform.toLowerCase().includes('mac');
const FOLLOW_KEYS = isMac ? '⌘J' : 'Ctrl+J';

interface Placed {
  pointer: Pointer;
  /** Whether the row it sits on is its target's own, not the row of something holding it. */
  own: boolean;
}

interface Placement {
  id: number;
  rect: { top: number; left: number; right: number; bottom: number; width: number; height: number };
  placed: Placed[];
}

const ids = new WeakMap<HTMLElement, number>();
let nextId = 1;
function idOf(el: HTMLElement): number {
  let id = ids.get(el);
  if (id === undefined) ids.set(el, (id = nextId++));
  return id;
}

function world(): PointWorld {
  return {
    displays: useTerminalStore.getState().displayStates,
    tasksByProject: useAppStore.getState().taskCacheByProject,
  };
}

function place(pointers: Pointer[]): Placement[] {
  const w = world();
  const byElement = new Map<HTMLElement, Placement>();
  for (const pointer of pointers) {
    const anchor = findAnchor(anchorChain(pointer.target, w));
    if (!anchor) continue;
    const own = anchor.depth === 0 && hasOwnRow(pointer.target);
    const existing = byElement.get(anchor.el);
    if (existing) {
      existing.placed.push({ pointer, own });
      continue;
    }
    const r = anchor.el.getBoundingClientRect();
    byElement.set(anchor.el, {
      id: idOf(anchor.el),
      rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      placed: [{ pointer, own }],
    });
  }
  return [...byElement.values()];
}

/** Drops pointers whose target, or the terminal that pointed, has gone. */
function usePrunePointers(): void {
  useEffect(() => {
    const prune = () => {
      const w = world();
      const { pointers, dismiss } = usePointerStore.getState();
      for (const p of pointers) {
        if (!(p.from in w.displays) || !targetAlive(p.target, w)) dismiss(p.from);
      }
    };
    const stopTerminals = useTerminalStore.subscribe(prune);
    const stopApp = useAppStore.subscribe(prune);
    return () => {
      stopTerminals();
      stopApp();
    };
  }, []);
}

/** Where each pointer sits, re-measured every frame while there are any, since rows scroll and fold. */
function usePlacements(pointers: Pointer[]): Placement[] {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const last = useRef('');
  useEffect(() => {
    if (pointers.length === 0) {
      last.current = '';
      setPlacements([]);
      return;
    }
    let frame = 0;
    const tick = () => {
      const next = place(pointers);
      const signature = JSON.stringify(
        next.map((p) => [p.id, p.rect, p.placed.map((x) => [x.pointer.from, x.pointer.at, x.own])]),
      );
      if (signature !== last.current) {
        last.current = signature;
        setPlacements(next);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [pointers]);
  return placements;
}

function useFollowShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || !(isMac ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      const latest = latestPointer(usePointerStore.getState().pointers);
      if (!latest) return;
      e.preventDefault();
      e.stopPropagation();
      void followPointer(latest);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

const SIZE = 24;
const OVERLAP = 6;

/** A circle on the row's right edge, overlapping it a little, its arrow toward it. */
function markStyle(rect: Placement['rect']): React.CSSProperties {
  return {
    left: rect.right - OVERLAP,
    top: rect.top + rect.height / 2 - SIZE / 2,
    width: SIZE,
    height: SIZE,
    borderRadius: '50%',
    justifyContent: 'center',
  };
}

const ROW =
  'w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left flex items-center gap-2 whitespace-nowrap hover:bg-ink/[0.08]';

function Mark({ placement, latest }: { placement: Placement; latest: Pointer | undefined }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displays = useTerminalStore((s) => s.displayStates);
  const { placed } = placement;
  const style = markStyle(placement.rect);
  const newest = placed.find((x) => x.pointer === latestPointer(placed.map((y) => y.pointer)))!;
  const w = world();
  const where = ({ pointer, own }: Placed) => {
    const base = pointer.ask
      ? `asks to run ${pointer.ask.command}`
      : own
        ? 'points here'
        : `points to ${describeTarget(pointer.target, w)}`;
    // The newest move is the one pointed at; the rest wait behind it.
    const behind = (pointer.waiting?.length ?? 0) - (pointer.moved ? 1 : 0);
    return behind > 0 ? `${base}, and ${behind} more waiting` : base;
  };
  const fromName = (p: Pointer) => displays[p.from]?.label ?? 'A terminal';
  const label = (x: Placed) =>
    x.pointer.message && !x.pointer.ask
      ? `${x.pointer.message}, from ${fromName(x.pointer)}`
      : `${fromName(x.pointer)}, which ${where(x)}`;

  const hold = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const release = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <>
      <button
        type="button"
        aria-label={`Follow ${label(newest)}`}
        className="fixed z-[10002] flex items-center border-none p-0 bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer"
        style={{ ...style, boxShadow: '0 2px 8px color-mix(in srgb, var(--color-accent) 45%, transparent)' }}
        onClick={() => void followPointer(newest.pointer)}
        onMouseEnter={hold}
        onMouseLeave={release}
      >
        {placed.length > 1 ? (
          <span>{placed.length}</span>
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13 8H3M7 4L3 8l4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pointers"
          className="fixed z-[10003] p-1 glass-bevel border border-bezel rounded-[12px] min-w-[200px] max-w-[320px]"
          style={{
            left: Number(style.left) + SIZE + 6,
            top: Number(style.top) - 6,
            background: 'var(--color-terminal-bg)',
            boxShadow: 'var(--shadow-menu)',
          }}
          onMouseEnter={hold}
          onMouseLeave={release}
        >
          {placed.map((x) => (
            <div key={x.pointer.from} className="group/row flex items-center gap-1">
              <button type="button" className={ROW} onClick={() => void followPointer(x.pointer)}>
                {x.pointer.message && !x.pointer.ask ? (
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5 whitespace-normal">
                    <span className="text-[13px] leading-snug">{x.pointer.message}</span>
                    <span className="text-text-tertiary">
                      {fromName(x.pointer)}
                      {!x.own && ` · on ${describeTarget(x.pointer.target, w)}`}
                    </span>
                  </span>
                ) : (
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-semibold">{fromName(x.pointer)}</span> {where(x)}
                  </span>
                )}
                {x.pointer === latest && (
                  <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-ink/[0.06] text-text-tertiary">
                    {FOLLOW_KEYS}
                  </kbd>
                )}
              </button>
              <button
                type="button"
                aria-label={`Dismiss ${fromName(x.pointer)}'s pointer`}
                className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[6px] border-none bg-transparent text-text-tertiary hover:bg-ink/[0.1] hover:text-text-primary"
                onClick={() => usePointerStore.getState().dismiss(x.pointer.from)}
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Every agent's pointer, as a mark on the sidebar row of what it points at. */
export function PointerLayer() {
  const pointers = usePointerStore((s) => s.pointers);
  usePrunePointers();
  useFollowShortcut();
  const placements = usePlacements(pointers);
  const latest = latestPointer(pointers);
  return createPortal(
    <>
      {placements.map((p) => (
        <Mark key={p.id} placement={p} latest={latest} />
      ))}
      <AskRunDialog />
    </>,
    document.body,
  );
}
