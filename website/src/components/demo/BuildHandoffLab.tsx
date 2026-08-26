import { useEffect, useRef, useState } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import type { TerminalDisplayState } from '../../ouijit-ui/terminalDisplay';
import { DEFAULT_DISPLAY_STATE } from '../../ouijit-ui/terminalDisplay';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { SESSIONS, N, PEEK, TOP_PAD, NARROW } from './BuildStackLab';
import { DeskWash } from './DeskWash';

/**
 * Build section lab, round 11 — the Plan section's handoff, carried on.
 * There, cards fly from source desks into the To Do column. Here the column
 * arrives full and stays full: starting a task does not take it off the board,
 * it gives it a terminal. Each task grows the connected-terminal row the
 * kanban card already draws, and the session it spawned flies to the stack.
 *
 * The stack keeps the app's behaviour (see BuildStackLab): the arriving
 * session takes the front, everything already on it goes one peek further
 * back, and ⌘1 is the deepest card. The one difference is when the terminal
 * appears — it materialises as the flight lands, filling the place the stack
 * has been opening.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const PER_CARD_VH = 30;
const TAIL_VH = 26;
const RUN_VH = 100 + N * PER_CARD_VH + TAIL_VH;
const GROW_SPAN = (N * PER_CARD_VH) / (RUN_VH - 100);

/** The flight is done a little before the window is, so the terminal lands
 *  rather than appearing mid-air. */
const LAND_AT = 0.88;

function task(taskNumber: number, name: string, branch: string): TaskWithWorkspace {
  return {
    taskNumber,
    name,
    status: 'todo',
    branch,
    worktreePath: `/demo/horizon/.ouijit/worktrees/T-${taskNumber}`,
    createdAt: '2026-05-08T09:00:00Z',
  };
}

const TASKS: TaskWithWorkspace[] = [
  task(101, 'Rework onboarding flow', 'rework-onboarding'),
  task(102, 'Wire payment retries to dunning queue', 'billing-retries'),
  task(103, 'Polish invitation email', 'polish-invitation-email'),
  task(104, 'Speed up search index build', 'speed-search-index'),
  task(105, 'Add CSV export to invoices', 'invoices-csv-export'),
];

const CONNECTED: TerminalDisplayState[] = SESSIONS.map((session, i) => ({
  ...DEFAULT_DISPLAY_STATE,
  projectPath: '/demo/horizon',
  ptyId: `pty-${101 + i}-claude`,
  label: 'claude',
  summaryType: session.state === 'ready' ? 'ready' : 'thinking',
  lastOscTitle: session.osc,
  taskId: 101 + i,
}));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Progress across the run, plus the rectangles a flight interpolates between,
 * both measured against the stage on every scroll frame — the same shape as
 * the Plan section's scrub.
 */
function useHandoffStage() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const slotEls = useRef<Array<HTMLElement | null>>([]);
  const destRef = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState(0);
  const [geom, setGeom] = useState<{ slots: Box[]; dest: Box } | null>(null);
  const sig = useRef('');

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const wrap = wrapRef.current;
      const stage = stageRef.current;
      if (!wrap) return;

      const rect = wrap.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const nextT = span > 0 ? clamp01(-rect.top / span) : 0;

      let nextG: { slots: Box[]; dest: Box } | null = null;
      if (stage && destRef.current) {
        const s = stage.getBoundingClientRect();
        const rel = (el: Element): Box => {
          const b = el.getBoundingClientRect();
          return { x: b.left - s.left, y: b.top - s.top, w: b.width, h: b.height };
        };
        const slots = slotEls.current.map((el) => (el ? rel(el) : null));
        if (slots.every(Boolean) && slots.length === N) {
          nextG = { slots: slots as Box[], dest: rel(destRef.current) };
        }
      }

      const nextSig = JSON.stringify([
        Math.round(nextT * 800),
        nextG && [nextG.dest.x, nextG.dest.y, nextG.dest.w, nextG.slots.map((b) => [b.x, b.y, b.w])].flat(3).map(Math.round),
      ]);
      if (nextSig !== sig.current) {
        sig.current = nextSig;
        setT(nextT);
        setGeom(nextG);
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const setSlot = (i: number) => (el: HTMLDivElement | null) => void (slotEls.current[i] = el);
  return { wrapRef, stageRef, destRef, setSlot, t, geom };
}

function useStaticMode() {
  const [staticMode, setStaticMode] = useState(false);
  useEffect(() => {
    const queries = [window.matchMedia('(max-width: 999px)'), window.matchMedia('(prefers-reduced-motion: reduce)')];
    const update = () => setStaticMode(queries.some((q) => q.matches));
    update();
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return staticMode;
}

/**
 * The task in transit: out of its slot, over the gap, onto the stack. It keeps
 * its own size — scaling it to the destination turned a kanban card into a
 * 1100px one on the way over — and fades as the session takes its place.
 */
function TaskGhost({ task, from, to, p }: { task: TaskWithWorkspace; from: Box; to: Box; p: number }) {
  const e = easeInOut(p);
  const land = { x: to.x + (to.w - from.w) / 2, y: to.y + 12 };
  return (
    <div
      className="glass-bevel absolute rounded-[10px] overflow-hidden border border-bezel-panel pointer-events-none"
      style={{
        left: lerp(from.x, land.x, e),
        // Lifts on the way, the way the Plan section's handoff arcs.
        top: lerp(from.y, land.y, e) - 34 * Math.sin(Math.PI * e),
        width: from.w,
        zIndex: 60,
        background: 'var(--color-terminal-bg)',
        boxShadow: 'var(--shadow-panel), 0 24px 48px -16px rgba(0, 0, 0, 0.6)',
        opacity: Math.min(1, p / 0.1) * (1 - clamp01((p - 0.9) / 0.1)),
      }}
    >
      <KanbanCardView task={task} showBadge={false} />
    </div>
  );
}

export function VariantHandoff() {
  const { wrapRef, stageRef, destRef, setSlot, t, geom } = useHandoffStage();
  const staticMode = useStaticMode();

  // One window per task: the card leaves its slot, flies, and lands as a
  // session. `gone` counts the tasks that have left the column.
  const gone = staticMode ? N : clamp01(t / GROW_SPAN) * N;
  const flying = Math.min(N - 1, Math.floor(gone));
  const f = staticMode ? 1 : clamp01(gone - flying);
  const landed = staticMode ? N : Math.floor(gone) + (f >= LAND_AT ? 1 : 0);

  const frontIndex = landed - 1;
  const backCards = Math.max(0, frontIndex - 1 + clamp01(f / LAND_AT));

  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : `${RUN_VH}vh` }}>
      <div className="hx-sticky">
        <div ref={stageRef} className="hx-stage">
          <div className="hx-column">
            <div className="glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel">
              <KanbanColumnView status="todo" label="To Do" count={N}>
                {TASKS.map((task, i) => {
                  // The row appears as the flight lands, so the card gains its
                  // terminal at the moment the stack does.
                  const connected = staticMode || i < Math.floor(gone) || (i === flying && f >= LAND_AT);
                  return (
                    <div key={task.taskNumber} ref={setSlot(i)}>
                      <KanbanCardView
                        task={task}
                        connectedDisplays={connected ? [CONNECTED[i]] : []}
                        isSettingUp={!connected && i === flying && f > 0.04}
                        showBadge={false}
                      />
                    </div>
                  );
                })}
              </KanbanColumnView>
            </div>
          </div>

          <div className="plan-desk desk-wash desk-wash--iris hx-desk">
            <DeskWash />
            <div ref={destRef} className="stk-well" style={{ top: TOP_PAD + backCards * PEEK }}>
              {SESSIONS.map((session, i) => {
                if (i > frontIndex) return null;
                const front = i === frontIndex;
                const rank = i + 1;
                const depth = front ? 0 : frontIndex - 1 - i + clamp01(f / LAND_AT);
                return (
                  <div
                    key={session.task}
                    className="stk-card"
                    style={{
                      zIndex: front ? 10 : 10 - Math.max(1, Math.ceil(depth)),
                      transform: `translateY(${-depth * PEEK}px) scaleX(${1 - depth * NARROW})`,
                    }}
                  >
                    <TerminalCardView isActive={front}>
                      <TerminalHeaderView
                        summaryType={session.state}
                        isActive={front}
                        isBackCard={!front}
                        stackPosition={front ? undefined : rank}
                        nameContent={
                          <TerminalHeaderName label={front ? 'claude' : session.label} lastOscTitle={session.osc} />
                        }
                        branchContent={
                          front ? (
                            <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink/45">
                              <Icon name="git-branch" className="w-3 h-3" />
                              {session.branch}
                            </span>
                          ) : undefined
                        }
                      />
                      {front && session.body}
                    </TerminalCardView>
                  </div>
                );
              })}
            </div>
          </div>

          {!staticMode && geom && f > 0 && f < 1 && flying < N && (
            <TaskGhost task={TASKS[flying]} from={geom.slots[flying]} to={geom.dest} p={clamp01(f / LAND_AT)} />
          )}
        </div>
      </div>
    </div>
  );
}
