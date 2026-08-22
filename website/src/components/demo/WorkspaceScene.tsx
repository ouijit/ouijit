import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskStatus, TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { KanbanAddInput } from '../../ouijit-ui/components/kanban/KanbanAddInput';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import {
  TerminalHeaderView,
  TerminalHeaderName,
  TerminalHeaderTags,
} from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import type { TerminalDisplayState } from '../../ouijit-ui/terminalDisplay';
import { DEFAULT_DISPLAY_STATE } from '../../ouijit-ui/terminalDisplay';
import { featuresTasks, featuresTerminalsByTask, FEATURES_PROJECT_PATH } from './featuresFixtures';
import { MockPlanPanel, MockPreviewPanel, MockDiffPanel, getPanelFixtures, type PanelFixtures } from './MockPanels';
import {
  STACK_TERMINALS,
  type StackTerminal,
  type PanelKind,
  BranchLabel,
  ActiveActions,
  ClaudeShell,
  ClaudeUser,
  ToolCall,
  ToolResult,
  Continuation,
  AssistantSay,
  ClaudeBody,
  DevServerBody,
  TestBody,
  ShellBody,
} from './stackParts';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

const DEMO_COMMAND = 'ouijit task spawn "Migrate to React 19"';
const DEMO_PRETYPED = 'ouijit'.length;
const DEMO_TASK_NUMBER = 142;
const DEMO_PTY_ID = 'pty-142-claude';

const DEMO_TASK: TaskWithWorkspace = {
  taskNumber: DEMO_TASK_NUMBER,
  name: 'Migrate to React 19',
  status: 'in_progress',
  branch: 'migrate-react-19',
  worktreePath: `${FEATURES_PROJECT_PATH}/.ouijit/worktrees/T-${DEMO_TASK_NUMBER}`,
  createdAt: '2026-05-08T09:00:00Z',
};

const SUBTASKS: TaskWithWorkspace[] = [
  {
    taskNumber: 143,
    name: 'Update Suspense boundaries',
    status: 'todo',
    parentTaskNumber: DEMO_TASK_NUMBER,
    createdAt: '2026-05-08T09:00:01Z',
  },
  {
    taskNumber: 144,
    name: 'Audit useTransition usages',
    status: 'todo',
    parentTaskNumber: DEMO_TASK_NUMBER,
    createdAt: '2026-05-08T09:00:02Z',
  },
];

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
  label: 'Migrate to React 19',
  summaryType: 'thinking',
  lastOscTitle: 'Spinning up...',
  branch: 'migrate-react-19',
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
  const [terminals, setTerminals] = useState<StackTerminal[]>(STACK_TERMINALS);
  const [stackOrder, setStackOrder] = useState<string[]>(() => STACK_TERMINALS.map((t) => t.ptyId));

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
    // Clear anything still in flight, then reset to the opening state, so a
    // click works the same whether it's the first play or a replay.
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    intervalsRef.current.forEach(clearInterval);
    intervalsRef.current = [];

    setTasks(featuresTasks);
    setTerminalsByTask(featuresTerminalsByTask);
    setTerminals(STACK_TERMINALS);
    setStackOrder(STACK_TERMINALS.map((t) => t.ptyId));
    setTypingProgress(DEMO_PRETYPED);
    setHighlightTaskNumber(null);
    setStreamStep(0);
    setDemoComplete(false);
    setShowDemoNotification(false);
    setOpenPanelByPty({});
    setDemoStarted(true);

    const at = (fn: () => void, delay: number) => timersRef.current.push(setTimeout(fn, delay));

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
    at(() => {
      setTasks((prev) => [DEMO_TASK, ...prev]);
      setHighlightTaskNumber(DEMO_TASK_NUMBER);
    }, TYPING_DURATION + 150);

    // After the card finishes growing (~520ms) plus a generous beat so the
    // viewer can register the new card with its setup spinner, spawn the
    // terminal at the front of the stack.
    at(() => {
      setTerminals((prev) => [DEMO_TERMINAL, ...prev]);
      setStackOrder((prev) => [DEMO_PTY_ID, ...prev]);
      setTerminalsByTask((prev) => ({ ...prev, [DEMO_TASK_NUMBER]: [DEMO_TERMINAL_DISPLAY] }));
    }, TYPING_DURATION + 1900);

    // Clear the pulse highlight a touch after the terminal lands.
    at(() => setHighlightTaskNumber(null), TYPING_DURATION + 3100);

    // Stream the agent body, line by line. Slow pacing so each beat
    // — terminal text, kanban motion, action buttons — has a moment to
    // register before the next one lands.
    const STEPS = 6;
    const STEP_MS = 1100;
    const STREAM_START = TYPING_DURATION + 2450;
    const stepAt = (step: number) => STREAM_START + (step - 1) * STEP_MS;
    for (let step = 1; step <= STEPS; step += 1) {
      at(() => setStreamStep(step), stepAt(step));
    }

    // At step 3, the agent's two `ouijit task create` calls land — fan
    // the subtasks into the Todo column with their own pulse highlights.
    at(() => {
      setTasks((prev) => [...prev, ...SUBTASKS]);
      setHighlightTaskNumber(143);
    }, stepAt(3));
    at(() => setHighlightTaskNumber(144), stepAt(3) + 300);
    at(() => setHighlightTaskNumber(null), stepAt(3) + 1800);

    // At step 6, the agent runs `ouijit task set-status 142 in_review` —
    // animate the parent card from In Progress to In Review and pulse it.
    at(() => {
      setTasks((prev) => prev.map((t) => (t.taskNumber === DEMO_TASK_NUMBER ? { ...t, status: 'in_review' } : t)));
      setHighlightTaskNumber(DEMO_TASK_NUMBER);
    }, stepAt(6));
    at(() => setHighlightTaskNumber(null), stepAt(6) + 1600);

    // Final beat: terminal goes idle. Then, after a short delay so the
    // status change registers, the macOS notification slides in.
    const completeAt = stepAt(STEPS) + 200;
    at(() => setDemoComplete(true), completeAt);
    at(() => setShowDemoNotification(true), completeAt + 750);
  }, []);

  // Each terminal's stack depth comes from stackOrder, but we render them in
  // a stable DOM order so React never has to reorder children. Reordering
  // would re-attach one of the cards and cancel its CSS transition mid-flight.
  // The visual stacking is handled entirely by zIndex/transform from
  // TerminalCardView's DEPTH_STYLES.
  const positionByPtyId = useMemo(() => new Map(stackOrder.map((id, i) => [id, i])), [stackOrder]);

  // Scale-to-fit. The scene's internal layout is locked at 1160×630 with
  // pixel-precise absolute positions. Below 1160px viewport we shrink the
  // whole composition with transform: scale so positions stay coherent.
  // Below MIN_SCALE the canvas stops shrinking — instead the wrapper clips
  // the left/right edges, so phones and small windows still get the
  // middle-of-the-action read.
  const CANVAS_WIDTH = 1160;
  const BOARD_WIDTH = 880;
  const BOARD_HEIGHT = 520;
  const STACK_WIDTH = 720;
  const STACK_HEIGHT = 530;
  // The mobile canvas is just wide enough to seat the stack-width board/stack
  // with a small side gutter, so they fill more of a phone's width.
  const MOBILE_CANVAS_WIDTH = STACK_WIDTH + 56;
  const MOBILE_BREAKPOINT = 768;
  const MIN_SCALE = 0.85;
  const computeScale = (width: number) => Math.min(1, Math.max(MIN_SCALE, width / CANVAS_WIDTH));
  const frameRef = useRef<HTMLDivElement>(null);
  const initialWidth = typeof window === 'undefined' ? CANVAS_WIDTH : window.innerWidth;
  const [scale, setScale] = useState(() => computeScale(initialWidth));
  const [wrapperWidth, setWrapperWidth] = useState(initialWidth);
  useEffect(() => {
    const el = frameRef.current;
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
  // Below this width the scene reflows to a vertical stack: the board on top,
  // the terminal stack centered below it, with no overlap. Above it the board
  // and stack overlap as a single scaled composition.
  const isMobile = wrapperWidth <= MOBILE_BREAKPOINT;
  // The board is shorter on mobile - its columns scroll internally, so a
  // trimmed height just shows fewer cards rather than empty space.
  const MOBILE_BOARD_HEIGHT = 440;
  const boardHeight = isMobile ? MOBILE_BOARD_HEIGHT : BOARD_HEIGHT;
  // The stack carries ~80px of built-in top padding for its back-card peek, so
  // this offsets against that to land the visible gap below the board.
  const MOBILE_GAP = 128;
  const sceneWidth = isMobile ? MOBILE_CANVAS_WIDTH : CANVAS_WIDTH;
  const sceneHeight = isMobile ? boardHeight + MOBILE_GAP + STACK_HEIGHT : 630;
  const renderScale = isMobile ? wrapperWidth / sceneWidth : scale;

  const visualCanvasWidth = CANVAS_WIDTH * scale;
  const spaceLeft = (wrapperWidth - visualCanvasWidth) / 2;
  let driftX = 0;
  if (!isMobile && spaceLeft < 0) {
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
    <div ref={frameRef} className="workspace-scene-frame">
      <div className="workspace-scene-clip" style={{ height: sceneHeight * renderScale }}>
        <div
          className="workspace-scene"
          style={{
            position: 'relative',
            width: sceneWidth,
            height: sceneHeight,
            flexShrink: 0,
            transform: `translateX(${driftX}px) scale(${renderScale})`,
            transformOrigin: 'top center',
          }}
        >
          {/* Board layer — matches the app's .kanban-board (glass-bevel + black border + rounded). */}
          <div
            className="workspace-scene-board glass-bevel"
            style={{
              position: 'absolute',
              top: 0,
              height: boardHeight,
              display: 'flex',
              background: 'var(--color-terminal-bg, #171717)',
              border: '1px solid rgba(0, 0, 0, 0.6)',
              borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 30px 80px -30px rgba(0,0,0,0.7)',
              // On mobile the board narrows to the stack's width and shares its
              // left edge, so the two read as one centered column.
              ...(isMobile
                ? { left: (MOBILE_CANVAS_WIDTH - STACK_WIDTH) / 2, width: STACK_WIDTH }
                : { left: 0, width: BOARD_WIDTH }),
            }}
          >
            {COLUMNS.map(({ status, label }) => {
              const tasksInColumn = tasks.filter((t) => t.status === status);
              return (
                <KanbanColumnView
                  key={status}
                  status={status}
                  label={label}
                  count={tasksInColumn.length}
                  footer={status === 'todo' ? <KanbanAddInput onAdd={() => {}} /> : undefined}
                >
                  {tasksInColumn.map((task) => {
                    const isDemoTask = task.taskNumber >= DEMO_TASK_NUMBER;
                    const taskTerminals = terminalsByTask[task.taskNumber] ?? [];
                    const isSettingUp = task.taskNumber === DEMO_TASK_NUMBER && taskTerminals.length === 0;
                    const card = (
                      <KanbanCardView
                        task={task}
                        connectedDisplays={taskTerminals}
                        showBadge={false}
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
                  title={`${DEMO_TASK.name} is ready`}
                  onActivate={() => bringToFront(DEMO_PTY_ID)}
                  onReplay={playDemo}
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
                left: 62,
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
              width: STACK_WIDTH,
              zIndex: 2,
              filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.6))',
              ...(isMobile
                ? { left: (MOBILE_CANVAS_WIDTH - STACK_WIDTH) / 2, top: boardHeight + MOBILE_GAP }
                : { right: 0, bottom: 0 }),
            }}
          >
            <div style={{ position: 'relative', height: 450, paddingTop: 80 }}>
              {terminals.map((term) => {
                const position = positionByPtyId.get(term.ptyId) ?? 0;
                const isActive = position === 0;
                const isDemoTerminal = term.ptyId === DEMO_PTY_ID;
                const summaryType = isDemoTerminal && demoComplete ? 'ready' : term.summaryType;
                const lastOscTitle = isDemoTerminal && demoComplete ? '18 passed' : term.lastOscTitle;
                const fixtures = getEffectiveFixtures(term.ptyId, streamStep);
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
                      nameContent={<TerminalHeaderName label={term.label} lastOscTitle={lastOscTitle} />}
                      tagsContent={isActive && term.tags ? <TerminalHeaderTags tags={term.tags} /> : undefined}
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
              title={`${DEMO_TASK.name} is ready`}
              onActivate={() => bringToFront(DEMO_PTY_ID)}
              onReplay={playDemo}
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

/** The demo terminal's action buttons appear in lock-step with its tool
 * calls: Plan reveals when the agent writes plan.md (step ≥ 2), Diff
 * reveals when the agent edits a file (step ≥ 4). Other terminals always
 * use their full fixture set. */
function getEffectiveFixtures(ptyId: string, streamStep: number): PanelFixtures {
  const base = getPanelFixtures(ptyId);
  if (ptyId !== DEMO_PTY_ID) return base;
  return {
    plan: streamStep >= 2 ? base.plan : undefined,
    diff: streamStep >= 4 ? base.diff : undefined,
    preview: base.preview,
  };
}

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

/** Streaming Claude body for the demo terminal. The agent reads, plans,
 * fans out three subtasks via `ouijit task create`, edits the parent
 * (revealing the Diff button), runs tests, and finally moves the parent
 * to In Review with `ouijit task set-status` — showcasing how an agent
 * uses the ouijit CLI to manage its own task lifecycle. */
function DemoStreamBody({ step, complete }: { step: number; complete: boolean }) {
  return (
    <ClaudeShell busy={!complete && step >= 1}>
      {step >= 1 && (
        <ClaudeUser>Migrate the app to React 19. Split the work into subtasks for the obvious chunks.</ClaudeUser>
      )}
      {step >= 2 && (
        <>
          <ToolCall name="Write" args="plan.md" />
          <ToolResult>
            <span className="text-[#3fb950]">+24</span>
            <span className="ml-2 text-white/55">lines (new)</span>
          </ToolResult>
          <Continuation>codemod first, then Suspense boundaries, then useTransition audit</Continuation>
        </>
      )}
      {step >= 3 && (
        <>
          <ToolCall name="Bash" args={'ouijit task create "Update Suspense boundaries"'} />
          <ToolResult>
            Created task <span className="text-white/85">#143</span>
          </ToolResult>
          <ToolCall name="Bash" args={'ouijit task create "Audit useTransition usages"'} />
          <ToolResult>
            Created task <span className="text-white/85">#144</span>
          </ToolResult>
        </>
      )}
      {step >= 4 && (
        <>
          <ToolCall name="Edit" args="package.json" />
          <ToolResult>
            <span className="text-[#3fb950]">+2</span>
            <span className="mx-1 text-white/30">/</span>
            <span className="text-[#f85149]">−2</span>
            <span className="ml-2 text-white/55">lines · pin react/react-dom to 19.0.0</span>
          </ToolResult>
        </>
      )}
      {step >= 5 && (
        <>
          <ToolCall name="Bash" args="npx types-react-codemod preset-19 src/" />
          <ToolResult>
            <span className="text-[#3fb950]">42 files</span>
            <span className="ml-2 text-white/55">touched · ref types updated</span>
          </ToolResult>
        </>
      )}
      {step >= 6 && (
        <>
          <ToolCall name="Bash" args="ouijit task set-status 142 in_review" />
          <ToolResult>
            #142 <span className="text-white/65">in_progress → in_review</span>
          </ToolResult>
        </>
      )}
      {complete && (
        <AssistantSay>
          <span>Ready for review.</span>
          <span className="ml-1 text-white/55">2 subtasks queued, codemod applied.</span>
        </AssistantSay>
      )}
    </ClaudeShell>
  );
}

/** Floating glass pill mimicking a quick CLI invocation. Until clicked, shows
 * the full command with a blinking cursor and a "Run" affordance, plus an
 * idle attention pulse to invite the click. On click, the affordance falls
 * away and the command reveals character by character via `typedChars`. */
function CliPromptBubble({ typedChars, played, onPlay }: { typedChars: number; played: boolean; onPlay: () => void }) {
  const visible = DEMO_COMMAND.slice(0, typedChars);
  const remaining = DEMO_COMMAND.slice(typedChars);
  return (
    <button
      type="button"
      className={`cli-prompt-bubble${played ? ' is-played' : ''}`}
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
      <span className="cli-prompt-bubble__run" aria-hidden="true" style={played ? { visibility: 'hidden' } : undefined}>
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
function NotificationPreview({
  title,
  onActivate,
  onReplay,
}: {
  title: string;
  onActivate?: () => void;
  onReplay?: () => void;
}) {
  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReplay?.();
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
      {/* The macOS close affordance (top-left circle on hover) is repurposed
          as the replay control — hovering the banner reveals it, clicking it
          replays the demo. */}
      <button type="button" className="macos-notif-replay" aria-label="Replay the demo" onClick={handleReplay}>
        <Icon name="arrow-counter-clockwise" className="w-3 h-3" />
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
