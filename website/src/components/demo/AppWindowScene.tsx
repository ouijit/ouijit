import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TaskStatus } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { KanbanAddInput } from '../../ouijit-ui/components/kanban/KanbanAddInput';
import { KanbanPrBadgeView } from '../../ouijit-ui/components/kanban/KanbanPrBadgeView';
import { TerminalCardView } from '../../ouijit-ui/components/terminal/TerminalCardView';
import { TerminalHeaderView, TerminalHeaderName } from '../../ouijit-ui/components/terminal/TerminalHeaderView';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { featuresTasks, featuresTerminalsByTask } from './featuresFixtures';
import { MockPlanPanel, MockPreviewPanel, MockDiffPanel } from './MockPanels';
import { MockPullRequests } from './MockPullRequests';
import { MockAnalysis } from './MockAnalysis';
import { MockCommandPalette } from './MockCommandPalette';
import {
  STACK_TERMINALS,
  type PanelKind,
  BranchLabel,
  ActiveActions,
  renderStaticBody,
  getPanelFixtures,
} from './stackParts';

const COLUMNS: { status: TaskStatus; label: string; hooked: boolean }[] = [
  { status: 'todo', label: 'To Do', hooked: false },
  { status: 'in_progress', label: 'In Progress', hooked: true },
  { status: 'in_review', label: 'In Review', hooked: true },
  { status: 'done', label: 'Done', hooked: false },
];

/** Tasks whose branch went up as a pull request; the chip opens the PR view. */
const PR_BY_TASK: Record<number, number> = { 99: 486, 98: 482, 95: 479 };

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 800;
const MIN_SCALE = 0.62;

/** The titlebar's extruded view-toggle group, mirroring TitleBarReact. */
const SEG_GROUP = 'flex items-center h-9 bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] overflow-hidden';
// Active and resting styles are disjoint: appending overrides to one base
// string leaves the winner to stylesheet order, not class order.
const SEG_BTN_BASE =
  'w-9 h-full flex items-center justify-center border-none transition-all duration-150 ease-out [&>svg]:w-5 [&>svg]:h-5';
const segBtn = (active: boolean) =>
  `${SEG_BTN_BASE} ${
    active
      ? 'text-text-primary bg-background-tertiary'
      : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary'
  }`;
const SQUARE_BTN =
  'w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] text-text-secondary [&>svg]:w-5 [&>svg]:h-5';
/** The sidebar and search pair left of the project name: no bevel and no
 *  border, so they read as titlebar chrome rather than as controls. */
const PLAIN_BTN = 'w-9 h-9 flex items-center justify-center rounded-[10px] [&>svg]:w-5 [&>svg]:h-5';

/**
 * The whole app in one window: titlebar, project sidebar, and the kanban
 * board, rendered from the same view components the app itself uses.
 * Below MIN_SCALE the window stops shrinking and clips at both edges so
 * phones still get a legible middle-of-the-board read.
 */
export default function AppWindowScene() {
  const frameRef = useRef<HTMLDivElement>(null);
  const computeScale = (width: number) => Math.min(1, Math.max(MIN_SCALE, width / CANVAS_WIDTH));
  // Starts at the server-rendered scale(1): hydrating with a different value
  // would mismatch the SSR inline style, which React leaves in the DOM.
  const [scale, setScale] = useState(1);

  const [view, setView] = useState<'board' | 'stack' | 'prs' | 'analysis'>('board');
  // Closed by default like the app, where the rail is a hover/pin overlay and
  // the titlebar project icon toggles it.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The diff-bearing terminal leads so the stack opens on the diff panel.
  const [stackOrder, setStackOrder] = useState<string[]>([
    'pty-103-test',
    'pty-101-claude',
    'pty-101-dev',
    'pty-105-shell',
  ]);
  // One of each key panel open in split view from the start, so browsing the
  // stack shows them all off without any toggling.
  const [openPanelByPty, setOpenPanelByPty] = useState<Record<string, PanelKind | null>>({
    'pty-101-claude': 'plan',
    'pty-101-dev': 'preview',
    'pty-103-test': 'diff',
  });

  const bringToFront = useCallback((ptyId: string) => {
    setStackOrder((prev) => (prev[0] === ptyId ? prev : [ptyId, ...prev.filter((id) => id !== ptyId)]));
  }, []);

  const openTerminal = useCallback(
    (ptyId: string) => {
      bringToFront(ptyId);
      setView('stack');
    },
    [bringToFront],
  );

  const togglePanel = useCallback((ptyId: string, kind: PanelKind) => {
    setOpenPanelByPty((prev) => ({ ...prev, [ptyId]: prev[ptyId] === kind ? null : kind }));
  }, []);

  // The rail supplies the content's left inset while open, the way the app's
  // --sidebar-offset does; closed, the panels keep their own 16px.
  const contentLeft = sidebarOpen ? 0 : 16;

  // Stable DOM order so reordering never re-attaches a card mid-transition;
  // the visual stacking comes entirely from TerminalCardView's depth styles.
  const positionByPtyId = useMemo(() => new Map(stackOrder.map((id, i) => [id, i])), [stackOrder]);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setScale(computeScale(entries[0].contentRect.width)));
    observer.observe(el);
    setScale(computeScale(el.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="app-window-frame">
      <div className="app-window-clip" style={{ height: CANVAS_HEIGHT * scale }}>
        <div
          className="app-window glass-bevel"
          style={{
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            transform: `scale(${scale})`,
          }}
        >
          <div className="app-window-lights" aria-hidden="true">
            <span style={{ background: '#ff5f57' }} />
            <span style={{ background: '#febc2e' }} />
            <span style={{ background: '#28c840' }} />
          </div>
          <div className="app-window-titlebar">
            {/* One wrapper so the pair sits the titlebar's own 8px from the
                project name; the 18px gap is between the lights and the pair. */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex items-center h-9 shrink-0">
                <button
                  type="button"
                  aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                  aria-expanded={sidebarOpen}
                  className={`${PLAIN_BTN} ${sidebarOpen ? 'text-text-primary bg-background-secondary' : 'text-text-secondary'}`}
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                >
                  <Icon name="sidebar-simple" />
                </button>
                <button
                  type="button"
                  aria-label="Toggle search"
                  aria-expanded={paletteOpen}
                  className={`${PLAIN_BTN} ${paletteOpen ? 'text-text-primary bg-background-secondary' : 'text-text-secondary'}`}
                  onClick={() => setPaletteOpen(!paletteOpen)}
                >
                  <Icon name="magnifying-glass" />
                </button>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <ProjectAvatar size={32} />
                <div className="flex flex-col gap-[2px] min-w-0">
                  <span className="text-[15px] font-semibold text-text-primary leading-none tracking-tight truncate">
                    horizon
                  </span>
                  <span className="text-[11px] font-mono text-text-tertiary leading-[1.3] truncate">
                    ~/Code/horizon
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={SEG_GROUP}>
                <button className={segBtn(view === 'board')} aria-label="Board view" onClick={() => setView('board')}>
                  <Icon name="kanban" />
                </button>
                <button className={segBtn(view === 'stack')} aria-label="Terminal stack" onClick={() => setView('stack')}>
                  <Icon name="cards-three" />
                </button>
                <button className={segBtn(view === 'prs')} aria-label="Pull requests" onClick={() => setView('prs')}>
                  <Icon name="git-pull-request" />
                </button>
                <button
                  className={segBtn(view === 'analysis')}
                  aria-label="Analysis"
                  onClick={() => setView('analysis')}
                >
                  <Icon name="binoculars" />
                </button>
                <span className={segBtn(false)}>
                  <Icon name="gear" />
                </span>
              </div>
              <span className={SQUARE_BTN}>
                <Icon name="terminal" />
              </span>
              <span className={SQUARE_BTN}>
                <Icon name="plus" />
              </span>
            </div>
          </div>
          <div className="flex flex-1 min-h-0">
            {sidebarOpen && (
            <div className="flex flex-col items-center shrink-0 w-[72px] pt-1 pb-4">
              <div className="w-10 h-10">
                <div className="app-window-logo-mask w-full h-full" />
              </div>
              <div className="mt-2 mb-1 shrink-0" style={{ width: 32, height: 1, background: 'var(--color-border)' }} />
              <div className="relative flex items-center justify-center w-full h-12 mt-2">
                <div className="absolute left-0 w-1 h-9 rounded-r-sm bg-ink" />
                <ProjectAvatar size={40} />
                <span
                  className="absolute flex items-center justify-center font-bold text-accent-ink"
                  style={{
                    right: 8,
                    bottom: 0,
                    minWidth: 16,
                    height: 16,
                    fontSize: 10,
                    lineHeight: 1,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: 'var(--color-accent)',
                  }}
                >
                  5
                </span>
              </div>
              <span className="mt-3 w-10 h-10 flex items-center justify-center relative glass-bevel overflow-hidden rounded-[12px] bg-background-secondary border border-bezel text-text-secondary [&>svg]:w-5 [&>svg]:h-5">
                <Icon name="plus" />
              </span>
            </div>
            )}
            {view === 'board' ? (
              <div
                className="glass-bevel relative flex flex-1 min-w-0 rounded-[14px] overflow-hidden border border-bezel-panel"
                style={{
                  margin: `0 16px 16px ${contentLeft}px`,
                  background: 'var(--color-terminal-bg)',
                  boxShadow: 'var(--shadow-panel)',
                }}
              >
                {COLUMNS.map(({ status, label, hooked }) => {
                  const tasksInColumn = featuresTasks.filter((t) => t.status === status);
                  return (
                    <KanbanColumnView
                      key={status}
                      status={status}
                      label={label}
                      count={tasksInColumn.length}
                      hookTypes={status === 'todo' ? [] : ['start']}
                      hasConfiguredHook={hooked}
                      onConfigureHook={status === 'todo' ? undefined : () => {}}
                      footer={status === 'todo' ? <KanbanAddInput onAdd={() => {}} /> : undefined}
                    >
                      {tasksInColumn.map((task) => {
                        const prNumber = PR_BY_TASK[task.taskNumber];
                        return (
                          <KanbanCardView
                            key={task.taskNumber}
                            task={task}
                            connectedDisplays={featuresTerminalsByTask[task.taskNumber] ?? []}
                            showBadge={false}
                            onSwitchToTerminal={openTerminal}
                            prBadge={
                              prNumber != null ? (
                                <KanbanPrBadgeView prNumber={prNumber} onClick={() => setView('prs')} />
                              ) : undefined
                            }
                          />
                        );
                      })}
                    </KanbanColumnView>
                  );
                })}
              </div>
            ) : view === 'prs' || view === 'analysis' ? (
              <div
                className="glass-bevel relative flex flex-1 min-w-0 rounded-[14px] overflow-hidden border border-bezel-panel"
                style={{
                  margin: `0 16px 16px ${contentLeft}px`,
                  background: 'var(--color-terminal-bg)',
                  boxShadow: 'var(--shadow-panel)',
                }}
              >
                {view === 'prs' ? <MockPullRequests /> : <MockAnalysis />}
              </div>
            ) : (
              <div className="flex-1 min-w-0 relative">
                {/* Mirrors the app's stack container: full content width, top
                    pushed down 24px per back card so their peeks fit above. */}
                <div
                  className="absolute"
                  style={{ left: contentLeft, right: 16, bottom: 16, top: 18 + (STACK_TERMINALS.length - 1) * 24 }}
                >
                  {STACK_TERMINALS.map((term) => {
                    const position = positionByPtyId.get(term.ptyId) ?? 0;
                    const isActive = position === 0;
                    const fixtures = getPanelFixtures(term.ptyId);
                    const openPanel = openPanelByPty[term.ptyId] ?? null;
                    return (
                      <TerminalCardView
                        key={term.ptyId}
                        ptyId={term.ptyId}
                        isActive={isActive}
                        backDepth={isActive ? 0 : position}
                        onClick={isActive ? undefined : () => bringToFront(term.ptyId)}
                      >
                        <TerminalHeaderView
                          summaryType={term.summaryType}
                          sandboxed={term.sandboxed}
                          isActive={isActive}
                          isBackCard={!isActive}
                          stackPosition={isActive ? undefined : position}
                          nameContent={<TerminalHeaderName label={term.label} lastOscTitle={term.lastOscTitle} />}
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
                          <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
                            <div className="flex-1 min-w-0 flex flex-col basis-1/2">{renderStaticBody(term.ptyId)}</div>
                            {openPanel && (
                              <>
                                <div className="pane-seam relative w-px shrink-0" />
                                <div className="relative min-h-0 basis-1/2 shrink-0 overflow-hidden">
                                  {openPanel === 'plan' && fixtures.plan && (
                                    <MockPlanPanel
                                      fixture={fixtures.plan}
                                      onClose={() => togglePanel(term.ptyId, 'plan')}
                                    />
                                  )}
                                  {openPanel === 'preview' && fixtures.preview && (
                                    <MockPreviewPanel
                                      fixture={fixtures.preview}
                                      onClose={() => togglePanel(term.ptyId, 'preview')}
                                    />
                                  )}
                                  {openPanel === 'diff' && fixtures.diff && (
                                    <MockDiffPanel
                                      fixture={fixtures.diff}
                                      compact
                                      onClose={() => togglePanel(term.ptyId, 'diff')}
                                    />
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </TerminalCardView>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {paletteOpen && <MockCommandPalette onClose={() => setPaletteOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

function ProjectAvatar({ size }: { size: number }) {
  return (
    <span
      className="flex items-center justify-center shrink-0 overflow-hidden rounded-md font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size >= 40 ? 14 : 12,
        background: '#e9679f',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
      }}
    >
      HO
    </span>
  );
}
