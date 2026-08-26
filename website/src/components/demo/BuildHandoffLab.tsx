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
import { TODO_COLUMN } from './PlanSection';
import { DeskWash } from './DeskWash';

/**
 * Build section lab, round 11 — the Plan section's handoff, carried on.
 *
 * The silhouette mirrors Plan's: the column moves to the left rail, in the
 * desk it was charged in, and the wide desk on the right is the terminal
 * stack rather than Plan's source panes. The traffic mirrors with it — cards
 * flew right into the column there, sessions spawn right out of it here,
 * draining the charge it arrived with.
 * There, cards fly from source desks into the To Do column. Here the column
 * arrives full and stays full: starting a task does not take it off the board,
 * it gives it a terminal. Each task grows the connected-terminal row the
 * kanban card already draws, and the session it spawned flies to the stack.
 *
 * The stack keeps the app's behaviour (see BuildStackLab): the arriving
 * session takes the front, everything already on it goes one peek further
 * back, and ⌘1 is the deepest card. The one difference is when the terminal
 * appears — it materialises as the flight lands.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Scroll brings the run into view and nothing more: the four handoffs are one
 * sequence on its own clock, offset a step apart, rather than four windows a
 * reader scrubs through at whatever pace they scroll. The section costs its
 * own height in scroll and holds nothing above it in place.
 */
const STEP_MS = 1100;

/** The stage settles in view before the first card leaves the column. */
const LEAD_MS = 400;

/** The flight is done a little before its step is, so the terminal lands
 *  rather than appearing mid-air. */
const LAND_AT = 0.88;

/** The column the Plan section hands over, working now rather than waiting. */
const TASKS = TODO_COLUMN.map((t) => ({ ...t, status: 'in_progress' as const }));

const DESK_GRAPHITE =
  'radial-gradient(120% 140% at 50% 0%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #1c1d23, #131318)';

/** Every task on the board is mid-run; none of them shows a finished dot. */
const CONNECTED: TerminalDisplayState[] = SESSIONS.map((session, i) => ({
  ...DEFAULT_DISPLAY_STATE,
  projectPath: '/demo/horizon',
  ptyId: `pty-${TODO_COLUMN[i].taskNumber}-claude`,
  label: session.label,
  summaryType: 'thinking',
  lastOscTitle: session.osc,
  taskId: TODO_COLUMN[i].taskNumber,
}));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far the run has got, in tasks, plus the rectangles a flight interpolates
 * between, measured against the stage. The clock only advances while the stage
 * is on screen, so the run always plays where it can be seen, and it stops for
 * good once the last session has landed.
 */
function useHandoffRun() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const slotEls = useRef<Array<HTMLElement | null>>([]);
  const destRef = useRef<HTMLDivElement | null>(null);
  const [gone, setGone] = useState(0);
  const [geom, setGeom] = useState<{ slots: Box[]; dest: Box } | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let visible = false;
    const io = new IntersectionObserver(([e]) => void (visible = e.isIntersecting), { threshold: 0.3 });
    io.observe(stage);

    let raf = 0;
    let last = performance.now();
    let elapsed = -LEAD_MS;
    let shownGone = -1;
    let sig = '';
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (visible) elapsed = Math.min(N * STEP_MS, elapsed + dt);

      const rect = stage.getBoundingClientRect();
      const rel = (el: Element): Box => {
        const b = el.getBoundingClientRect();
        return { x: b.left - rect.left, y: b.top - rect.top, w: b.width, h: b.height };
      };
      const slots = slotEls.current.map((el) => (el ? rel(el) : null));
      if (destRef.current && slots.length === N && slots.every(Boolean)) {
        const next = { slots: slots as Box[], dest: rel(destRef.current) };
        const nextSig = JSON.stringify(
          [next.dest.x, next.dest.y, next.dest.w, next.slots.map((b) => [b.x, b.y, b.w])].flat(3).map(Math.round),
        );
        if (nextSig !== sig) {
          sig = nextSig;
          setGeom(next);
        }
      }

      const next = clamp01(elapsed / (N * STEP_MS)) * N;
      const rounded = Math.round(next * 240);
      if (rounded !== shownGone) {
        shownGone = rounded;
        setGone(next);
      }
      /* The stack is a finished state, not a loop: once it is full there is
         nothing left to measure or advance. */
      if (next < N) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  const setSlot = (i: number) => (el: HTMLDivElement | null) => void (slotEls.current[i] = el);
  return { stageRef, destRef, setSlot, gone, geom };
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
  const land = { x: to.x + (to.w - from.w) / 2, y: to.y };
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
        // No fade out: the session takes its place on the frame it leaves, so
        // fading it early left a beat with neither on the stage.
        opacity: Math.min(1, p / 0.12),
      }}
    >
      <KanbanCardView task={task} showBadge={false} />
    </div>
  );
}

export function VariantHandoff() {
  const { stageRef, destRef, setSlot, gone: ran, geom } = useHandoffRun();
  const staticMode = useStaticMode();

  // One step per task: the card leaves its slot, flies, and lands as a
  // session. `gone` counts the tasks that have left the column.
  const gone = staticMode ? N : ran;
  const flying = Math.min(N - 1, Math.floor(gone));
  const f = staticMode ? 1 : clamp01(gone - flying);
  /*
   * The run says how many sessions are on the stack and nothing else. The
   * depths move on their own transitions from there, so a card settles at its
   * own pace instead of being dragged back a fraction of a peek at a time by
   * whatever is still in the air.
   */
  const onStack = staticMode ? N : Math.min(N, Math.floor(gone) + (f >= LAND_AT ? 1 : 0));
  const frontIndex = onStack - 1;
  const backCards = Math.max(0, frontIndex);
  /** The column arrived charged; it gives that up as its work becomes sessions. */
  const drain = onStack / N;

  return (
    <div className="hx-frame">
      <div ref={stageRef} className="hx-stage">
        <div className="hx-rail">
          {/* The desk the column was charged in, draining as the work in it
              turns into sessions — the Plan section's own drain, applied to
              the column instead of to a source pane. */}
          <div className="plan-desk desk-wash hx-todo-desk" style={{ backgroundImage: DESK_GRAPHITE }}>
            <DeskWash
              style={
                {
                  '--wash': 'var(--wash-prism)',
                  opacity: 0.9 * (1 - drain),
                  transition: 'opacity 0.4s ease',
                } as React.CSSProperties
              }
            />
            <div className="hx-column glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel">
              <KanbanColumnView status="in_progress" label="In Progress" count={N}>
                {TASKS.map((task, i) => {
                  // The row appears as the flight lands, so the card gains
                  // its terminal at the moment the stack does.
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
        </div>

        <div className="plan-desk desk-wash hx-desk" style={{ backgroundImage: DESK_GRAPHITE }}>
          <DeskWash
            style={
              { '--wash': 'var(--wash-iris)', opacity: 0.9 * drain, transition: 'opacity 0.4s ease' } as React.CSSProperties
            }
          />
          <div ref={destRef} className="stk-well" style={{ top: TOP_PAD + backCards * PEEK }}>
            {SESSIONS.map((session, i) => {
              if (i > frontIndex) return null;
              const front = i === frontIndex;
              const rank = i + 1;
              const depth = frontIndex - i;
              return (
                <div
                  key={session.task}
                  className="stk-card"
                  style={{
                    zIndex: 10 - depth,
                    transform: `translateY(${-depth * PEEK}px) scaleX(${1 - depth * NARROW})`,
                  }}
                >
                  <TerminalCardView isActive={front}>
                    <TerminalHeaderView
                      summaryType="thinking"
                      isActive={front}
                      isBackCard={!front}
                      stackPosition={front ? undefined : rank}
                      nameContent={
                        <TerminalHeaderName label={session.label} lastOscTitle={session.osc} />
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

        {!staticMode && geom && f > 0 && f < LAND_AT && flying < N && (
          <TaskGhost task={TASKS[flying]} from={geom.slots[flying]} to={geom.dest} p={clamp01(f / LAND_AT)} />
        )}
      </div>
    </div>
  );
}
