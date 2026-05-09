import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskStatus, TaskWithWorkspace } from '@app/types';
import { KanbanColumnView } from '@app/components/kanban/KanbanColumnView';
import { KanbanCardView } from '@app/components/kanban/KanbanCardView';
import { KanbanBadgeView } from '@app/components/kanban/KanbanBadgeView';
import { KanbanAddInput } from '@app/components/kanban/KanbanAddInput';
import { TerminalCardView } from '@app/components/terminal/TerminalCardView';
import { TerminalHeaderView } from '@app/components/terminal/TerminalHeaderView';
import { Icon } from '@app/components/terminal/Icon';
import { isChainMember, buildChainMap } from '@app/utils/taskChain';
import type { TerminalDisplayState } from '@app/stores/terminalStore';
import { DEFAULT_DISPLAY_STATE } from '@app/stores/terminalStore';
import {
  featuresTasks,
  featuresTerminalsByTask,
  FEATURES_PROJECT_PATH,
} from './featuresFixtures';
import {
  MockPlanPanel,
  MockPreviewPanel,
  MockDiffPanel,
  getPanelFixtures,
  type PanelFixtures,
} from './MockPanels';

type PanelKind = 'plan' | 'preview' | 'diff';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

interface StackTerminal {
  ptyId: string;
  label: string;
  summaryType: string;
  lastOscTitle: string;
  branch?: string;
  sandboxed?: boolean;
  tags?: string[];
}

const INITIAL_TERMINALS: StackTerminal[] = [
  {
    ptyId: 'pty-101-claude',
    label: 'Rework onboarding flow',
    summaryType: 'thinking',
    lastOscTitle: 'Editing onboarding stepper...',
    branch: 'rework-onboarding',
  },
  {
    ptyId: 'pty-101-dev',
    label: 'Rework onboarding flow',
    summaryType: 'ready',
    lastOscTitle: 'live dev server',
    branch: 'rework-onboarding',
  },
  {
    ptyId: 'pty-103-test',
    label: 'Polish invitation email',
    summaryType: 'ready',
    lastOscTitle: 'Tightened subject and brand tokens',
    branch: 'polish-invitation-email',
  },
  {
    ptyId: 'pty-105-shell',
    label: 'Audit accessibility on settings dialog',
    summaryType: 'thinking',
    lastOscTitle: 'Investigating contrast at SettingsDialog:121',
  },
];

const DEMO_COMMAND = 'ouijit task create-and-start "Add 2FA"';
const DEMO_PRETYPED = 'ouijit'.length;
const DEMO_TASK_NUMBER = 142;
const DEMO_PTY_ID = 'pty-142-claude';

const DEMO_TASK: TaskWithWorkspace = {
  taskNumber: DEMO_TASK_NUMBER,
  name: 'Add 2FA',
  status: 'in_progress',
  branch: 'add-2fa',
  worktreePath: `${FEATURES_PROJECT_PATH}/.ouijit/worktrees/T-${DEMO_TASK_NUMBER}`,
  createdAt: '2026-05-08T09:00:00Z',
};

const DEMO_TERMINAL_DISPLAY: TerminalDisplayState = {
  ...DEFAULT_DISPLAY_STATE,
  projectPath: FEATURES_PROJECT_PATH,
  ptyId: DEMO_PTY_ID,
  label: 'claude',
  summaryType: 'thinking',
  lastOscTitle: 'Spinning up...',
  taskId: DEMO_TASK_NUMBER,
};

const DEMO_TERMINAL: StackTerminal = {
  ptyId: DEMO_PTY_ID,
  label: 'Add 2FA',
  summaryType: 'thinking',
  lastOscTitle: 'Spinning up...',
  branch: 'add-2fa',
};

/**
 * The features-page hero. A 4-column kanban board sits at the top of the
 * frame; a terminal stack belonging to the in_progress tasks overlaps the
 * board's lower-right corner and trails below the board's bottom edge.
 *
 * Interactive: clicking a back card in the stack promotes that terminal to
 * the front, and clicking a terminal pill on a kanban card brings the
 * matching terminal to the front of the stack. Clicking the bottom-left CLI
 * prompt bubble plays a one-shot demo that types the command, creates a new
 * task, spawns a terminal, and streams agent activity.
 */
export default function WorkspaceScene() {
  const [tasks, setTasks] = useState<TaskWithWorkspace[]>(featuresTasks);
  const [terminalsByTask, setTerminalsByTask] = useState(featuresTerminalsByTask);
  const [terminals, setTerminals] = useState<StackTerminal[]>(INITIAL_TERMINALS);
  const [stackOrder, setStackOrder] = useState<string[]>(() => INITIAL_TERMINALS.map((t) => t.ptyId));

  const [demoStarted, setDemoStarted] = useState(false);
  const [typingProgress, setTypingProgress] = useState(DEMO_PRETYPED);
  const [highlightTaskNumber, setHighlightTaskNumber] = useState<number | null>(null);
  const [streamStep, setStreamStep] = useState(0);
  const [demoComplete, setDemoComplete] = useState(false);
  const [showDemoNotification, setShowDemoNotification] = useState(false);
  const [openPanelByPty, setOpenPanelByPty] = useState<Record<string, PanelKind | null>>({});

  const togglePanel = useCallback((ptyId: string, kind: PanelKind) => {
    setOpenPanelByPty((prev) => ({
      ...prev,
      [ptyId]: prev[ptyId] === kind ? null : kind,
    }));
  }, []);

  const closePanel = useCallback((ptyId: string) => {
    setOpenPanelByPty((prev) => ({ ...prev, [ptyId]: null }));
  }, []);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      intervalsRef.current.forEach(clearInterval);
    },
    [],
  );

  const bringToFront = useCallback((ptyId: string) => {
    setStackOrder((prev) => (prev[0] === ptyId ? prev : [ptyId, ...prev.filter((id) => id !== ptyId)]));
  }, []);

  const playDemo = useCallback(() => {
    if (demoStarted) return;
    setDemoStarted(true);

    const TYPE_MS = 10;
    const TYPING_DURATION = (DEMO_COMMAND.length - DEMO_PRETYPED) * TYPE_MS;

    let charIdx = DEMO_PRETYPED;
    const typeInterval = setInterval(() => {
      charIdx += 1;
      setTypingProgress(charIdx);
      if (charIdx >= DEMO_COMMAND.length) {
        clearInterval(typeInterval);
      }
    }, TYPE_MS);
    intervalsRef.current.push(typeInterval);

    // After typing: drop the new task straight into In Progress. The
    // GrowingCard wrapper animates it from 0 to its natural height, pushing
    // T-103/T-101/etc. down so it's easy to spot.
    timersRef.current.push(
      setTimeout(() => {
        setTasks((prev) => [DEMO_TASK, ...prev]);
        setHighlightTaskNumber(DEMO_TASK_NUMBER);
      }, TYPING_DURATION + 150),
    );

    // After the card finishes growing (~520ms) plus a generous beat so the
    // viewer can register the new card with its setup spinner, spawn the
    // terminal at the front of the stack.
    timersRef.current.push(
      setTimeout(() => {
        setTerminals((prev) => [DEMO_TERMINAL, ...prev]);
        setStackOrder((prev) => [DEMO_PTY_ID, ...prev]);
        setTerminalsByTask((prev) => ({ ...prev, [DEMO_TASK_NUMBER]: [DEMO_TERMINAL_DISPLAY] }));
      }, TYPING_DURATION + 1900),
    );

    // Clear the pulse highlight a touch after the terminal lands.
    timersRef.current.push(
      setTimeout(() => setHighlightTaskNumber(null), TYPING_DURATION + 3100),
    );

    // Stream the agent body, line by line.
    for (let step = 1; step <= 5; step += 1) {
      timersRef.current.push(
        setTimeout(() => setStreamStep(step), TYPING_DURATION + 2450 + (step - 1) * 700),
      );
    }

    // Final beat: terminal goes idle. Then, after a short delay so the
    // status change registers, the macOS notification slides in.
    const completeAt = TYPING_DURATION + 2450 + 5 * 700 + 200;
    timersRef.current.push(setTimeout(() => setDemoComplete(true), completeAt));
    timersRef.current.push(setTimeout(() => setShowDemoNotification(true), completeAt + 750));
  }, [demoStarted]);

  // Each terminal's stack depth comes from stackOrder, but we render them in
  // a stable DOM order so React never has to reorder children. Reordering
  // would re-attach one of the cards and cancel its CSS transition mid-flight.
  // The visual stacking is handled entirely by zIndex/transform from
  // TerminalCardView's DEPTH_STYLES.
  const positionByPtyId = useMemo(
    () => new Map(stackOrder.map((id, i) => [id, i])),
    [stackOrder],
  );

  const chainMap = useMemo(() => buildChainMap(tasks), [tasks]);

  // Scale-to-fit. The scene's internal layout is locked at 1160×630 with
  // pixel-precise absolute positions. Below 1160px viewport we shrink the
  // whole composition with transform: scale so positions stay coherent.
  // Below MIN_SCALE the canvas stops shrinking — instead the wrapper clips
  // the left/right edges, so phones and small windows still get the
  // middle-of-the-action read.
  const CANVAS_WIDTH = 1160;
  const MIN_SCALE = 0.85;
  const computeScale = (width: number) =>
    Math.min(1, Math.max(MIN_SCALE, width / CANVAS_WIDTH));
  const clipRef = useRef<HTMLDivElement>(null);
  const initialWidth = typeof window === 'undefined' ? CANVAS_WIDTH : window.innerWidth;
  const [scale, setScale] = useState(() => computeScale(initialWidth));
  const [wrapperWidth, setWrapperWidth] = useState(initialWidth);
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const update = (width: number) => {
      setWrapperWidth(width);
      setScale(computeScale(width));
    };
    update(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => update(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The canvas stays centered in the clip via flex (so vertical alignment
  // is unaffected). We additionally apply a horizontal drift so that when
  // the viewport just starts being too narrow, only the RIGHT edge clips
  // (preserving the Todo column + setup spinner on the left). As overflow
  // grows past RIGHT_ONLY_OVERFLOW, the drift eases back to 0 so both
  // sides clip evenly by FULLY_CENTERED_OVERFLOW.
  const visualCanvasWidth = CANVAS_WIDTH * scale;
  const spaceLeft = (wrapperWidth - visualCanvasWidth) / 2;
  let driftX = 0;
  if (spaceLeft < 0) {
    const overflow = -spaceLeft * 2;
    const RIGHT_ONLY_OVERFLOW = 360;
    const FULLY_CENTERED_OVERFLOW = 760;
    const t = Math.min(
      1,
      Math.max(0, (overflow - RIGHT_ONLY_OVERFLOW) / (FULLY_CENTERED_OVERFLOW - RIGHT_ONLY_OVERFLOW)),
    );
    driftX = -spaceLeft * (1 - t);
  }

  return (
    <div className="workspace-scene-frame">
      <div ref={clipRef} className="workspace-scene-clip" style={{ height: 630 * scale }}>
        <div
          className="workspace-scene"
          style={{
            position: 'relative',
            width: 1160,
            height: 630,
            flexShrink: 0,
            transform: `translateX(${driftX}px) scale(${scale})`,
            transformOrigin: 'top center',
          }}
        >
      {/* Board layer — matches the app's .kanban-board (glass-bevel + black border + rounded). */}
      <div
        className="workspace-scene-board glass-bevel"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 280,
          height: 520,
          display: 'flex',
          background: 'var(--color-background)',
          border: '1px solid rgba(0, 0, 0, 0.6)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.7)',
        }}
      >
        {COLUMNS.map(({ status, label }) => {
          const tasksInColumn = tasks.filter((t) => t.status === status);
          return (
            <KanbanColumnView key={status} status={status} label={label} count={tasksInColumn.length}>
              {tasksInColumn.map((task) => {
                const chainInfo = chainMap.get(task.taskNumber);
                const showBadge = isChainMember(chainInfo);
                const isDemoTask = task.taskNumber === DEMO_TASK_NUMBER;
                const taskTerminals = terminalsByTask[task.taskNumber] ?? [];
                const isSettingUp = isDemoTask && taskTerminals.length === 0;
                const card = (
                  <KanbanCardView
                    task={task}
                    connectedDisplays={taskTerminals}
                    chainInfo={chainInfo}
                    showBadge={showBadge}
                    badge={
                      showBadge ? <KanbanBadgeView taskNumber={task.taskNumber} chainInfo={chainInfo} /> : null
                    }
                    onSwitchToTerminal={bringToFront}
                    isSettingUp={isSettingUp}
                  />
                );
                if (isDemoTask) {
                  return (
                    <GrowingCard key={task.taskNumber} pulse={highlightTaskNumber === task.taskNumber}>
                      {card}
                    </GrowingCard>
                  );
                }
                return <Fragment key={task.taskNumber}>{card}</Fragment>;
              })}
              {status === 'todo' && <KanbanAddInput onAdd={() => {}} />}
            </KanbanColumnView>
          );
        })}
      </div>

      {/* Top-right: macOS-style notification banner that posts once the demo
          terminal goes idle. Mirrors where macOS actually fires
          notifications. Clicking it brings the matching terminal to the
          front of the stack. Only rendered at full scale; on smaller
          viewports the notification renders below the scene as a
          full-width banner above the CLI prompt instead. */}
      {showDemoNotification && scale === 1 && (
        <div
          className="workspace-scene-notification"
          style={{
            position: 'absolute',
            top: 8,
            right: -15,
            width: 270,
            zIndex: 3,
          }}
        >
          <FadeInWrapper>
            <NotificationPreview
              title="Add 2FA is ready"
              onActivate={() => bringToFront(DEMO_PTY_ID)}
            />
          </FadeInWrapper>
        </div>
      )}

      {/* Bottom-left: CLI prompt bubble. Only rendered at full scale; on
          smaller viewports the same prompt is rendered below the scaled
          canvas in .workspace-scene-cli-row instead, where it stays full
          size and centered. */}
      {scale === 1 && (
        <div
          className="workspace-scene-cli"
          style={{
            position: 'absolute',
            left: 70,
            bottom: 22,
            zIndex: 3,
          }}
        >
          <CliPromptBubble typedChars={typingProgress} played={demoStarted} onPlay={playDemo} />
        </div>
      )}

      {/* Terminal stack layer. */}
      <div
        className="workspace-scene-stack"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 720,
          zIndex: 2,
          filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.6))',
        }}
      >
        <div style={{ position: 'relative', height: 450, paddingTop: 80 }}>
          {terminals.map((term) => {
            const position = positionByPtyId.get(term.ptyId) ?? 0;
            const isActive = position === 0;
            const isDemoTerminal = term.ptyId === DEMO_PTY_ID;
            const summaryType = isDemoTerminal && demoComplete ? 'ready' : term.summaryType;
            const lastOscTitle = isDemoTerminal && demoComplete ? '18 passed' : term.lastOscTitle;
            const fixtures = getPanelFixtures(term.ptyId);
            const openPanel = openPanelByPty[term.ptyId] ?? null;
            return (
              <TerminalCardView
                key={term.ptyId}
                isActive={isActive}
                backDepth={isActive ? 0 : position}
                onClick={isActive ? undefined : () => bringToFront(term.ptyId)}
              >
                <TerminalHeaderView
                  summaryType={summaryType}
                  sandboxed={term.sandboxed}
                  isActive={isActive}
                  isBackCard={!isActive}
                  stackPosition={isActive ? undefined : position}
                  label={term.label}
                  lastOscTitle={lastOscTitle}
                  tags={isActive ? term.tags : undefined}
                  branchContent={isActive && term.branch ? <BranchLabel branch={term.branch} /> : undefined}
                  actions={
                    isActive ? (
                      <ActiveActions
                        fixtures={fixtures}
                        openPanel={openPanel}
                        onToggle={(kind) => togglePanel(term.ptyId, kind)}
                      />
                    ) : undefined
                  }
                />
                {isActive && (
                  <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
                    {renderBody(term.ptyId, streamStep, demoComplete)}
                    {openPanel === 'plan' && fixtures.plan && (
                      <MockPlanPanel fixture={fixtures.plan} onClose={() => closePanel(term.ptyId)} />
                    )}
                    {openPanel === 'preview' && fixtures.preview && (
                      <MockPreviewPanel fixture={fixtures.preview} onClose={() => closePanel(term.ptyId)} />
                    )}
                    {openPanel === 'diff' && fixtures.diff && (
                      <MockDiffPanel fixture={fixtures.diff} onClose={() => closePanel(term.ptyId)} />
                    )}
                  </div>
                )}
              </TerminalCardView>
            );
          })}
        </div>
      </div>
        </div>
      </div>

      {/* Mobile/tablet: notification surfaces as a full-width banner above
          the CLI prompt (mirroring how macOS notifications stack on a small
          screen) instead of overlapping the scene's top-right corner. */}
      {scale < 1 && showDemoNotification && (
        <div className="workspace-scene-notification-row">
          <FadeInWrapper>
            <NotificationPreview
              title="Add 2FA is ready"
              onActivate={() => bringToFront(DEMO_PTY_ID)}
            />
          </FadeInWrapper>
        </div>
      )}

      {/* On smaller viewports where the scene gets scaled or clipped, render
          the prompt below the canvas at full size, centered, so it's still
          legible and clickable. At full scale the prompt lives in the
          scene's bottom-left corner instead (see above). */}
      {scale < 1 && (
        <div className="workspace-scene-cli-row">
          <CliPromptBubble typedChars={typingProgress} played={demoStarted} onPlay={playDemo} />
        </div>
      )}
    </div>
  );
}

/** Wraps a freshly-spawned kanban card and animates its height from 0 up to
 * its natural content height on mount, pushing surrounding cards down. The
 * grid-template-rows 0fr → 1fr trick lets us transition to `auto` height
 * without measuring. */
function GrowingCard({ children, pulse }: { children: ReactNode; pulse: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className={pulse ? 'workspace-scene-task-grow workspace-scene-task-pulse' : 'workspace-scene-task-grow'}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: 'grid-template-rows 520ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </div>
  );
}

/** Fades + slides children up into place on mount. Used so the notification
 * doesn't pop into existence — it eases up from below its final position
 * like a real macOS banner being posted. */
function FadeInWrapper({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(18px)',
        transition: 'opacity 360ms ease-out, transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {children}
    </div>
  );
}

/** Static branch chip mimicking the in-app BranchCopy without the interactive copy state. */
function BranchLabel({ branch }: { branch: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-white/45 self-start shrink-0">
      <Icon name="git-branch" className="w-3 h-3 shrink-0 text-white/35" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

/** Action group mirroring the app's ActionGroup: Plan, Preview, Diff, Run +
 * chevron. Plan/Preview/Diff are controlled — clicking toggles the matching
 * mock panel for the active terminal, with the open button highlighted. */
function ActiveActions({
  fixtures,
  openPanel,
  onToggle,
}: {
  fixtures: PanelFixtures;
  openPanel: PanelKind | null;
  onToggle: (kind: PanelKind) => void;
}) {
  const base = 'h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium';
  const inactive = 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
  const active = 'bg-accent text-white hover:bg-accent';
  const cls = (kind: PanelKind) => `${base} ${openPanel === kind ? active : inactive}`;
  const divider = <div aria-hidden className="w-px h-3 bg-white/10 self-center" />;
  const diff = fixtures.diff;
  const diffAdds = diff?.files.reduce((s, f) => s + f.additions, 0) ?? 0;
  const diffDels = diff?.files.reduce((s, f) => s + f.deletions, 0) ?? 0;
  const handle = (kind: PanelKind) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(kind);
  };
  return (
    <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
      {fixtures.plan && (
        <>
          <button className={cls('plan')} onClick={handle('plan')}>
            <Icon name="list-checks" className="w-3.5 h-3.5" />
            <span>Plan</span>
          </button>
          {divider}
        </>
      )}
      {fixtures.preview && (
        <>
          <button className={cls('preview')} onClick={handle('preview')}>
            <Icon name="globe-simple" className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>
          {divider}
        </>
      )}
      {diff && diff.files.length > 0 && (
        <>
          <button className={cls('diff')} onClick={handle('diff')}>
            <span>
              {diff.files.length} {diff.files.length === 1 ? 'file' : 'files'}
            </span>
            {diffAdds > 0 && <span className="text-[#4ee82e]">+{diffAdds}</span>}
            {diffDels > 0 && <span className="text-[#ff6b6b]">-{diffDels}</span>}
          </button>
          {divider}
        </>
      )}
      <button className={`${base} ${inactive}`}>
        <span>Run</span>
      </button>
      <button className={`${base} ${inactive} !px-2`} aria-label="More run options">
        <Icon name="caret-down" className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

const BODY_CLS =
  'flex-1 p-4 font-mono text-[11px] leading-[1.65] text-white/85 overflow-hidden min-h-0 flex flex-col';

function renderBody(ptyId: string, streamStep: number, demoComplete: boolean): ReactNode {
  switch (ptyId) {
    case 'pty-101-claude':
      return <ClaudeBody />;
    case 'pty-101-dev':
      return <DevServerBody />;
    case 'pty-103-test':
      return <TestBody />;
    case 'pty-105-shell':
      return <ShellBody />;
    case DEMO_PTY_ID:
      return <DemoStreamBody step={streamStep} complete={demoComplete} />;
    default:
      return null;
  }
}

/* ─── Claude conversation atoms ──────────────────────────────────── */

function ClaudeUser({ children }: { children: ReactNode }) {
  return (
    <div className="text-white/70">
      <span className="text-white/35 mr-2">&gt;</span>
      {children}
    </div>
  );
}

/** Claude Code's bullet-style tool call header: green `⏺` dot, white text. */
function ToolCall({ name, args }: { name: string; args: ReactNode }) {
  return (
    <div className="mt-2 text-white/85">
      <span className="text-[#7ee787] mr-1.5">⏺</span>
      <span>{name}</span>
      <span className="text-white/45">(</span>
      <span>{args}</span>
      <span className="text-white/45">)</span>
    </div>
  );
}

/** Indented result body line (`  ⎿ ...`). */
function ToolResult({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <div className={`pl-4 ${dim ? 'text-white/40' : 'text-white/55'}`}>
      <span className="text-white/30 mr-1.5">⎿</span>
      {children}
    </div>
  );
}

function Continuation({ children, dim = true }: { children: ReactNode; dim?: boolean }) {
  return <div className={`pl-7 ${dim ? 'text-white/40' : 'text-white/55'}`}>{children}</div>;
}

function AssistantSay({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 text-white/85">
      <span className="text-white mr-1.5">⏺</span>
      {children}
    </div>
  );
}

/** Claude Code-style TUI input pinned to the bottom of the body. Two
 * horizontal rules with a `❯` prompt between them, followed by a status
 * line. The status line surfaces busy state inline ("esc to interrupt")
 * to match the real TUI. */
function ClaudeTuiInput({ busy = false, pendingText }: { busy?: boolean; pendingText?: string }) {
  return (
    <div className="shrink-0 mt-3">
      <div className="border-t border-white/15" />
      <div className="py-1.5 flex items-center gap-2">
        <span className="text-white/55">❯</span>
        <span className="flex-1 min-w-0 truncate text-white/85">
          {pendingText ?? <span className="text-white/25">Type a follow-up&hellip;</span>}
        </span>
      </div>
      <div className="border-t border-white/15" />
      <div className="mt-1 text-white/35 text-[10px]">
        Sonnet 4.6 {busy ? '· esc to interrupt' : '· ⏎ to send'} · ↓ to manage
      </div>
    </div>
  );
}

/** Wraps a Claude conversation: scrolling content area on top, TUI input
 * pinned at the bottom — matching the real Claude Code TUI layout. */
function ClaudeShell({
  children,
  busy,
  pendingText,
}: {
  children: ReactNode;
  busy?: boolean;
  pendingText?: string;
}) {
  return (
    <div className={BODY_CLS}>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      <ClaudeTuiInput busy={busy} pendingText={pendingText} />
    </div>
  );
}

/* ─── Bodies ─────────────────────────────────────────────────────── */

function ClaudeBody() {
  return (
    <ClaudeShell busy>
      <ClaudeUser>Split onboarding into a three-step stepper with saved progress.</ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll read the existing component first, then split it.</span>
      </AssistantSay>
      <ToolCall name="Read" args="src/onboarding/Stepper.tsx" />
      <ToolResult>Read 142 lines</ToolResult>
      <ToolCall name="Edit" args="src/onboarding/Stepper.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+92</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−14</span>
        <span className="ml-2 text-white/55">lines</span>
      </ToolResult>
      <Continuation>persists progress, adds back affordance, retires WelcomeIntro</Continuation>
      <ToolCall name="Write" args="src/onboarding/useOnboardingProgress.ts" />
      <ToolResult>
        <span className="text-[#3fb950]">+38</span>
        <span className="ml-2 text-white/55">lines (new)</span>
      </ToolResult>
      <ToolCall name="Bash" args="npm test -- onboarding" />
      <ToolResult>
        <span className="text-[#3fb950]">PASS</span>
        <span className="ml-2 text-white/65">14 tests</span>
        <span className="ml-2 text-white/35">in 2.1s</span>
      </ToolResult>
    </ClaudeShell>
  );
}

function DevServerBody() {
  const Hmr = ({ time, path }: { time: string; path: string }) => (
    <div>
      <span className="text-white/30">{time}</span>{' '}
      <span className="text-[#79b8ff]/80">[vite]</span>{' '}
      <span className="text-[#a4d4ff]/85">hmr update</span>{' '}
      <span className="text-white/55">{path}</span>
    </div>
  );
  return (
    <div className={BODY_CLS}>
      <div className="flex-1 min-h-0">
        <div>
          <span className="text-[#a78bfa] font-semibold">VITE</span>{' '}
          <span className="text-white/45">v5.4.10</span>
          <span className="ml-3 text-white/35">ready in 412 ms</span>
        </div>
        <div className="mt-2">
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/85 mr-1">Local:</span>
          <span className="text-[#79b8ff]">http://localhost:5173/</span>
        </div>
        <div>
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/85 mr-1">Network:</span>
          <span className="text-white/45">use --host to expose</span>
        </div>
        <div>
          <span className="text-[#3fb950] mr-1.5">➜</span>
          <span className="text-white/45">press </span>
          <span className="text-white/65">h + enter</span>
          <span className="text-white/45"> to show help</span>
        </div>
        <div className="mt-3" />
        <Hmr time="14:32:18" path="/src/onboarding/Stepper.tsx" />
        <Hmr time="14:32:21" path="/src/onboarding/WelcomeIntro.tsx" />
        <Hmr time="14:32:24" path="/src/onboarding/Stepper.tsx" />
        <div>
          <span className="text-white/30">14:32:34</span>{' '}
          <span className="text-[#79b8ff]/80">[vite]</span>{' '}
          <span className="text-[#ffb454]/90">page reload</span>{' '}
          <span className="text-white/45">src/onboarding/useOnboardingProgress.ts (new file)</span>
        </div>
        <Hmr time="14:32:41" path="/src/onboarding/Stepper.tsx" />
      </div>
    </div>
  );
}

function TestBody() {
  return (
    <ClaudeShell pendingText="run litmus on the new template">
      <ClaudeUser>
        Tighten the invitation email — subject line, brand tokens, plain-text fallback.
      </ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll start with the templates dir to see the shape.</span>
      </AssistantSay>
      <ToolCall name="Read" args="app/mailers/templates/invitation.tsx" />
      <ToolResult>Read 86 lines</ToolResult>
      <ToolCall name="Edit" args="app/mailers/templates/invitation.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+24</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−16</span>
        <span className="ml-2 text-white/55">lines</span>
      </ToolResult>
      <Continuation>tightens subject, drops inline colors, fixes plain-text fallback</Continuation>
      <ToolCall name="Edit" args="app/mailers/templates/styles.ts" />
      <ToolResult>
        <span className="text-[#3fb950]">+6</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−6</span>
        <span className="ml-2 text-white/55">lines · brand tokens</span>
      </ToolResult>
      <ToolCall name="Bash" args="npm test -- email" />
      <ToolResult>
        <span className="text-[#3fb950]">PASS</span>
        <span className="ml-2 text-white/65">14 tests</span>
        <span className="ml-2 text-white/35">in 1.1s</span>
      </ToolResult>
      <AssistantSay>
        <span>Subject is now 47 chars. Brand tokens applied. Want me to send a Litmus preview?</span>
      </AssistantSay>
    </ClaudeShell>
  );
}

function ShellBody() {
  return (
    <ClaudeShell busy>
      <ClaudeUser>Audit the settings dialog for WCAG 2.0 AA issues and queue fixes.</ClaudeUser>
      <AssistantSay>
        <span>I&rsquo;ll run axe against the rendered dialog first.</span>
      </AssistantSay>
      <ToolCall name="Bash" args="npx @axe-core/cli http://localhost:5173/settings" />
      <ToolResult>
        <span className="text-[#3fb950]">38 passes</span>
        <span className="mx-1.5 text-white/30">·</span>
        <span className="text-[#ff6b6b]">2 violations</span>
        <span className="mx-1.5 text-white/30">·</span>
        <span className="text-white/55">4 incomplete</span>
      </ToolResult>
      <ToolCall name="Read" args="src/components/SettingsDialog.tsx" />
      <ToolResult>Read 187 lines</ToolResult>
      <AssistantSay>
        <span>aria-required-parent — tab buttons need a tablist parent. Patching.</span>
      </AssistantSay>
      <ToolCall name="Edit" args="src/components/SettingsDialog.tsx" />
      <ToolResult>
        <span className="text-[#3fb950]">+6</span>
        <span className="mx-1 text-white/30">/</span>
        <span className="text-[#f85149]">−2</span>
        <span className="ml-2 text-white/55">lines · wraps tabs in role=tablist</span>
      </ToolResult>
      <AssistantSay>
        <span className="italic text-white/55">Investigating the contrast issue at line 121&hellip;</span>
      </AssistantSay>
    </ClaudeShell>
  );
}

/** Streaming Claude body for the demo terminal. Lines reveal one at a time
 * as `step` increments, mimicking an agent that just kicked off. Once
 * `complete` flips, the busy indicator collapses and a final review line
 * lands above the TUI input. */
function DemoStreamBody({ step, complete }: { step: number; complete: boolean }) {
  return (
    <ClaudeShell busy={!complete && step >= 1}>
      {step >= 1 && (
        <ClaudeUser>Add two-factor authentication with TOTP and recovery codes.</ClaudeUser>
      )}
      {step >= 2 && (
        <>
          <ToolCall name="Read" args="src/auth/AuthService.ts" />
          <ToolResult>Read 124 lines</ToolResult>
          <Continuation>session model exists, will extend with otpSecret + otpEnabledAt</Continuation>
        </>
      )}
      {step >= 3 && (
        <>
          <ToolCall name="Edit" args="src/auth/AuthService.ts" />
          <ToolResult>
            <span className="text-[#3fb950]">+87</span>
            <span className="mx-1 text-white/30">/</span>
            <span className="text-[#f85149]">−4</span>
            <span className="ml-2 text-white/55">lines</span>
          </ToolResult>
          <Continuation>setupTotp, verifyTotp, regenerateRecoveryCodes</Continuation>
        </>
      )}
      {step >= 4 && (
        <>
          <ToolCall name="Bash" args="npm test -- auth" />
          <ToolResult>
            <span className="text-[#3fb950]">PASS</span>
            <span className="ml-2 text-white/65">18 tests</span>
            <span className="ml-2 text-white/35">in 1.4s</span>
          </ToolResult>
        </>
      )}
      {complete && (
        <AssistantSay>
          <span>Ready for review.</span>
          <span className="ml-1 text-white/55">Touched 4 files, 18 tests pass.</span>
        </AssistantSay>
      )}
    </ClaudeShell>
  );
}

/** Floating glass pill mimicking a quick CLI invocation. Until clicked, shows
 * the full command with a blinking cursor and a "Run" affordance, plus an
 * idle attention pulse to invite the click. On click, the affordance falls
 * away and the command reveals character by character via `typedChars`. */
function CliPromptBubble({
  typedChars,
  played,
  onPlay,
}: {
  typedChars: number;
  played: boolean;
  onPlay: () => void;
}) {
  const visible = DEMO_COMMAND.slice(0, typedChars);
  const remaining = DEMO_COMMAND.slice(typedChars);
  return (
    <button
      type="button"
      className={`cli-prompt-bubble${played ? ' is-played' : ' is-idle'}`}
      onClick={onPlay}
      disabled={played}
      aria-label={played ? 'Demo started' : 'Run this command'}
    >
      <span className="cli-prompt-bubble__line">
        <span className="cli-prompt-bubble__prompt">$</span>
        <span className="cli-prompt-bubble__cmd">
          {renderTypedCommand(visible)}
          <span className="cli-prompt-bubble__cursor" aria-hidden="true" />
          <span className="cli-prompt-bubble__ghost" aria-hidden="true">
            {remaining}
          </span>
        </span>
      </span>
      <span
        className="cli-prompt-bubble__run"
        aria-hidden="true"
        style={played ? { visibility: 'hidden' } : undefined}
      >
        <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
          <path d="M1 1 L10 6.5 L1 12 Z" fill="currentColor" />
        </svg>
        <span>Run</span>
      </span>
    </button>
  );
}

/** Highlight `ouijit` and the quoted argument inside whatever portion of the
 * command has been "typed" so far. */
function renderTypedCommand(text: string): ReactNode {
  if (text.length === 0) return null;

  const parts: ReactNode[] = [];
  let cursor = 0;

  if (text.startsWith('ouijit')) {
    const slice = text.slice(0, Math.min(6, text.length));
    parts.push(
      <span key="bin" className="cli-prompt-bubble__bin">
        {slice}
      </span>,
    );
    cursor = slice.length;
  }

  const quoteIdx = text.indexOf('"');
  if (quoteIdx >= 0) {
    parts.push(<span key="mid">{text.slice(cursor, quoteIdx)}</span>);
    parts.push(
      <span key="arg" className="cli-prompt-bubble__arg">
        {text.slice(quoteIdx)}
      </span>,
    );
  } else {
    parts.push(<span key="rest">{text.slice(cursor)}</span>);
  }

  return parts;
}

/** macOS dark-mode notification banner mimicking the one Ouijit posts via
 * `new Notification(projectName, { body })` when a terminal goes ready.
 * Clicking the banner activates the matching terminal (like the OS banner
 * opening the source app); hovering reveals a close button in the top-left
 * that dismisses the notification without activating it. */
function NotificationPreview({ title, onActivate }: { title: string; onActivate?: () => void }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
  };

  return (
    <div
      className="macos-notif"
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate?.();
        }
      }}
    >
      <button
        type="button"
        className="macos-notif-close"
        aria-label="Dismiss notification"
        onClick={handleClose}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 2 L8 8 M8 2 L2 8"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <img
        src="/assets/ouijit-app-icon.png"
        alt=""
        width={36}
        height={36}
        style={{ flexShrink: 0, display: 'block' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'rgba(255, 255, 255, 0.95)',
              letterSpacing: 0.1,
            }}
          >
            Ouijit
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.5)', flexShrink: 0 }}>now</span>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 400,
            color: 'rgba(255, 255, 255, 0.85)',
            marginTop: 2,
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
      </div>
    </div>
  );
}
