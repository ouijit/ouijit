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
 *
 * The silhouette is Plan's, held: the To Do column stays on the right at the
 * same 372px rail, in the same graphite desk it was charged in, and the wide
 * desk on the left is now the terminal stack rather than the source panes.
 * The traffic is what reverses — cards flew right into the column there, and
 * sessions spawn left out of it here, draining the charge it arrived with.
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

const DESK_GRAPHITE =
  'radial-gradient(120% 140% at 50% 0%, rgba(255, 255, 255, 0.05), transparent 60%), linear-gradient(180deg, #1c1d23, #131318)';

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
  const { wrapRef, stageRef, destRef, setSlot, t, geom } = useHandoffStage();
  const staticMode = useStaticMode();

  // One window per task: the card leaves its slot, flies, and lands as a
  // session. `gone` counts the tasks that have left the column.
  const gone = staticMode ? N : clamp01(t / GROW_SPAN) * N;
  const flying = Math.min(N - 1, Math.floor(gone));
  const f = staticMode ? 1 : clamp01(gone - flying);
  /*
   * One value drives the stack, so nothing steps while something else eases.
   * `filled` is how many sessions have landed, fractionally: it rises with the
   * flight and reaches the next whole number exactly as the card touches down,
   * which is the same moment the count of landed sessions goes up.
   */
  const filled = staticMode ? N : Math.floor(gone) + clamp01(f / LAND_AT);
  const onStack = Math.floor(filled);
  const shove = filled - onStack;
  const frontIndex = onStack - 1;
  const backCards = Math.max(0, frontIndex + shove);
  /** The column arrived charged; it gives that up as its work becomes sessions. */
  const drain = clamp01(filled / N);

  return (
    <div ref={wrapRef} style={{ height: staticMode ? 'auto' : `${RUN_VH}vh` }}>
      <div className="hx-sticky">
        <div ref={stageRef} className="hx-stage">
          <div className="plan-desk desk-wash hx-desk" style={{ backgroundImage: DESK_GRAPHITE }}>
            <DeskWash style={{ '--wash': 'var(--wash-iris)', opacity: 0.9 * drain } as React.CSSProperties} />
            <div ref={destRef} className="stk-well" style={{ top: TOP_PAD + backCards * PEEK }}>
              {SESSIONS.map((session, i) => {
                if (i > frontIndex) return null;
                const front = i === frontIndex;
                const rank = i + 1;
                // Every card gives up `shove` of a peek as the next one flies
                // in, so the front card is only at depth 0 between landings.
                const depth = frontIndex - i + shove;
                return (
                  <div
                    key={session.task}
                    className="stk-card"
                    style={{
                      zIndex: front ? 10 : 10 - Math.max(1, Math.round(depth)),
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

          <div className="hx-rail">
            {/* The desk the column was charged in, draining as the work in it
                turns into sessions — the Plan section's own drain, applied to
                the column instead of to a source pane. */}
            <div className="plan-desk desk-wash hx-todo-desk" style={{ backgroundImage: DESK_GRAPHITE }}>
              <DeskWash
                style={{ '--wash': 'var(--wash-prism)', opacity: 0.9 * (1 - drain) } as React.CSSProperties}
              />
              <div className="hx-column glass-bevel relative flex rounded-[14px] overflow-hidden border border-bezel-panel">
                <KanbanColumnView status="todo" label="To Do" count={N}>
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

          {!staticMode && geom && f > 0 && f < LAND_AT && flying < N && (
            <TaskGhost task={TASKS[flying]} from={geom.slots[flying]} to={geom.dest} p={clamp01(f / LAND_AT)} />
          )}
        </div>
      </div>
    </div>
  );
}
