import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { latestPointer, usePointerStore, type Pointer } from '../../stores/pointerStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { Icon } from '../terminal/Icon';
import { anchorChain, describeTarget, targetAlive, type PointWorld } from './pointKeys';
import { findAnchor } from './pointAnchors';
import { followPointer } from './followPointer';

const isMac = navigator.platform.toLowerCase().includes('mac');
const FOLLOW_KEYS = isMac ? '⌘J' : 'Ctrl+J';

type Side = 'right' | 'left' | 'below';

interface Placed {
  pointer: Pointer;
  /** 0 when the ribbon is on the pointer's target itself, more when it stands on something holding it. */
  depth: number;
}

interface Placement {
  id: number;
  side: Side;
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
    const existing = byElement.get(anchor.el);
    if (existing) {
      existing.placed.push({ pointer, depth: anchor.depth });
      continue;
    }
    const r = anchor.el.getBoundingClientRect();
    byElement.set(anchor.el, {
      id: idOf(anchor.el),
      side: anchor.side,
      rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      placed: [{ pointer, depth: anchor.depth }],
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

/** Where each ribbon sits, re-measured every frame while there are any, since rows scroll and cards move. */
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
        next.map((p) => [p.id, p.rect, p.placed.map((x) => [x.pointer.from, x.pointer.at, x.depth])]),
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

const RIBBON = 24;
const OVERLAP = 6;
const EDGE = 8;

/** The side asked for, unless the ribbon would leave the window there. */
function fittedSide(p: Placement, long: number): Side {
  if (p.side === 'right' && p.rect.right - OVERLAP + long > window.innerWidth - EDGE) return 'left';
  if (p.side === 'left' && p.rect.left + OVERLAP - long < EDGE) return 'right';
  return p.side;
}

function ribbonBox(p: Placement, count: number): { style: React.CSSProperties; arrow: string; side: Side } {
  const long = 32 + (count > 1 ? 12 : 0);
  const { rect } = p;
  const side = fittedSide(p, long);
  if (side === 'below') {
    return {
      style: {
        left: rect.left + rect.width / 2 - RIBBON / 2,
        top: rect.bottom - OVERLAP,
        width: RIBBON,
        height: long,
        borderRadius: '4px 4px 12px 12px',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        paddingBottom: 6,
      },
      arrow: 'M8 13V3M4 7l4-4 4 4',
      side,
    };
  }
  const middle = rect.top + rect.height / 2 - RIBBON / 2;
  if (side === 'left') {
    return {
      style: {
        left: rect.left - long + OVERLAP,
        top: middle,
        width: long,
        height: RIBBON,
        borderRadius: '12px 4px 4px 12px',
        justifyContent: 'flex-start',
        paddingLeft: 7,
      },
      arrow: 'M3 8h10M9 4l4 4-4 4',
      side,
    };
  }
  return {
    style: {
      left: rect.right - OVERLAP,
      top: middle,
      width: long,
      height: RIBBON,
      borderRadius: '4px 12px 12px 4px',
      justifyContent: 'flex-end',
      paddingRight: 7,
    },
    arrow: 'M13 8H3M7 4L3 8l4 4',
    side,
  };
}

/** Beside the ribbon, on whichever side of it the window has more room. */
function cardPosition(side: Side, ribbon: React.CSSProperties): React.CSSProperties {
  const left = Number(ribbon.left);
  const right = left + Number(ribbon.width);
  const top = Number(ribbon.top);
  const roomLeft = left > window.innerWidth - right;
  if (side === 'below') {
    const below = top + Number(ribbon.height) + 6;
    return roomLeft ? { right: window.innerWidth - right - 8, top: below } : { left: left - 8, top: below };
  }
  return roomLeft ? { right: window.innerWidth - left + 6, top: top - 6 } : { left: right + 6, top: top - 6 };
}

const ROW =
  'w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left flex items-center gap-2 whitespace-nowrap hover:bg-ink/[0.08]';

function Ribbon({ placement, latest }: { placement: Placement; latest: Pointer | undefined }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displays = useTerminalStore((s) => s.displayStates);
  const { placed } = placement;
  const { style, arrow, side } = ribbonBox(placement, placed.length);
  const newest = placed.find((x) => x.pointer === latestPointer(placed.map((y) => y.pointer)))!;
  const w = world();
  const where = ({ pointer, depth }: Placed) =>
    depth === 0 ? 'points here' : `points to ${describeTarget(pointer.target, w)}`;
  const fromName = (p: Pointer) => displays[p.from]?.label ?? 'A terminal';
  const label = (x: Placed) =>
    x.pointer.message
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
        className="fixed z-[10002] flex items-center gap-1 border-none bg-accent text-accent-ink text-[11px] font-semibold cursor-pointer"
        style={{ ...style, boxShadow: '0 2px 8px color-mix(in srgb, var(--color-accent) 45%, transparent)' }}
        onClick={() => void followPointer(newest.pointer)}
        onMouseEnter={hold}
        onMouseLeave={release}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d={arrow} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {placed.length > 1 && <span>{placed.length}</span>}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Pointers"
          className="fixed z-[10003] p-1 glass-bevel border border-bezel rounded-[12px] min-w-[200px] max-w-[320px]"
          style={{
            ...cardPosition(side, style),
            background: 'var(--color-terminal-bg)',
            boxShadow: 'var(--shadow-menu)',
          }}
          onMouseEnter={hold}
          onMouseLeave={release}
        >
          {placed.map((x) => (
            <div key={x.pointer.from} className="group/row flex items-center gap-1">
              <button type="button" className={ROW} onClick={() => void followPointer(x.pointer)}>
                {x.pointer.message ? (
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5 whitespace-normal">
                    <span className="text-[13px] leading-snug">{x.pointer.message}</span>
                    <span className="text-text-tertiary">
                      {fromName(x.pointer)}
                      {x.depth > 0 && ` · on ${describeTarget(x.pointer.target, w)}`}
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

/** Every agent's pointer, as a ribbon on what it points at. */
export function PointerLayer() {
  const pointers = usePointerStore((s) => s.pointers);
  usePrunePointers();
  useFollowShortcut();
  const placements = usePlacements(pointers);
  const latest = latestPointer(pointers);
  return createPortal(
    <>
      {placements.map((p) => (
        <Ribbon key={p.id} placement={p} latest={latest} />
      ))}
    </>,
    document.body,
  );
}
