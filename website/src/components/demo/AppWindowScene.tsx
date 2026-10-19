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
import { MockSidebar, DEMO_WAITING, type DemoPage } from './MockSidebar';
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

const PAGE_TITLES: Record<DemoPage, string> = { board: 'Board', prs: 'Pull requests', analysis: 'Analysis' };
const SQUARE_BTN =
  'w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] text-text-secondary [&>svg]:w-5 [&>svg]:h-5';
/** The sidebar and search buttons left of the project name: no bevel and no
 *  border, so they read as titlebar chrome rather than as controls. */
const PLAIN_BTN = 'w-9 h-9 flex items-center justify-center rounded-[10px] [&>svg]:w-5 [&>svg]:h-5';

/**
 * The whole app in one window: sidebar, titlebar, and the kanban board,
 * rendered from the same view components the app itself uses.
 * Below MIN_SCALE the window stops shrinking and clips at both edges so
 * phones still get a legible middle-of-the-board read.
 */
export default function AppWindowScene() {
  const frameRef = useRef<HTMLDivElement>(null);
  const computeScale = (width: number) => Math.min(1, Math.max(MIN_SCALE, width / CANVAS_WIDTH));
  // Starts at the server-rendered scale(1): hydrating with a different value
  // would mismatch the SSR inline style, which React leaves in the DOM.
  const [scale, setScale] = useState(1);

  // A project page, or null while a terminal is shown.
  const [page, setPage] = useState<DemoPage | null>('board');
  const [shown, setShown] = useState<string>(DEMO_WAITING);
  const [waiting, setWaiting] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
      setShown(ptyId);
      setPage(null);
    },
    [bringToFront],
  );

  const openPage = useCallback((next: DemoPage) => setPage(next), []);

  // Leaving the terminal that was waiting is what marks it read.
  const showsWaiting = page === null && shown === DEMO_WAITING;
  const [seenWaiting, setSeenWaiting] = useState(false);
  useEffect(() => {
    if (showsWaiting) setSeenWaiting(true);
    else if (seenWaiting) setWaiting(false);
  }, [showsWaiting, seenWaiting]);

  // A stack holds one task's terminals.
  const shownTask = STACK_TERMINALS.find((t) => t.ptyId === shown)?.taskId;
  const stack = STACK_TERMINALS.filter((t) => t.taskId === shownTask);

  const togglePanel = useCallback((ptyId: string, kind: PanelKind) => {
    setOpenPanelByPty((prev) => ({ ...prev, [ptyId]: prev[ptyId] === kind ? null : kind }));
  }, []);

  const contentLeft = 16;

  // Stable DOM order so reordering never re-attaches a card mid-transition;
  // the visual stacking comes entirely from TerminalCardView's depth styles.
  const positionByPtyId = useMemo(
    () => new Map(stackOrder.filter((id) => stack.some((t) => t.ptyId === id)).map((id, i) => [id, i])),
    [stackOrder, stack],
  );
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
          <div className="flex h-full min-h-0">
            {sidebarOpen && (
              <MockSidebar
                page={page}
                shown={page === null ? shown : null}
                waiting={waiting}
                onPage={openPage}
                onTerminal={openTerminal}
                onHide={() => setSidebarOpen(false)}
              />
            )}
            <div className="flex flex-col flex-1 min-w-0">
              <div className="app-window-titlebar" style={sidebarOpen ? { paddingLeft: 16 } : undefined}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center h-9 shrink-0">
                    {!sidebarOpen && (
                      <button
                        type="button"
                        aria-label="Show sidebar"
                        className={`${PLAIN_BTN} text-text-secondary`}
                        onClick={() => setSidebarOpen(true)}
                      >
                        <Icon name="sidebar-simple" />
                      </button>
                    )}
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
                        {page && <span className="font-normal text-text-tertiary"> / {PAGE_TITLES[page]}</span>}
                      </span>
                      <span className="text-[11px] font-mono text-text-tertiary leading-[1.3] truncate">
                        ~/Code/horizon
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={SQUARE_BTN}>
                    <Icon name="terminal" />
                  </span>
                  <span className={SQUARE_BTN}>
                    <Icon name="plus" />
                  </span>
                </div>
              </div>
              <div className="flex flex-1 min-h-0">
                {page === 'board' ? (
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
                                    <KanbanPrBadgeView prNumber={prNumber} onClick={() => setPage('prs')} />
                                  ) : undefined
                                }
                              />
                            );
                          })}
                        </KanbanColumnView>
                      );
                    })}
                  </div>
                ) : page === 'prs' || page === 'analysis' ? (
                  <div
                    className="glass-bevel relative flex flex-1 min-w-0 rounded-[14px] overflow-hidden border border-bezel-panel"
                    style={{
                      margin: `0 16px 16px ${contentLeft}px`,
                      background: 'var(--color-terminal-bg)',
                      boxShadow: 'var(--shadow-panel)',
                    }}
                  >
                    {page === 'prs' ? <MockPullRequests /> : <MockAnalysis />}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 relative">
                    {/* Mirrors the app's stack container: full content width, top
                    pushed down 24px per back card so their peeks fit above. */}
                    <div
                      className="absolute"
                      style={{ left: contentLeft, right: 16, bottom: 16, top: 18 + (stack.length - 1) * 24 }}
                    >
                      {stack.map((term) => {
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
                              status={term.status}
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
                                <div className="flex-1 min-w-0 flex flex-col basis-1/2">
                                  {renderStaticBody(term.ptyId)}
                                </div>
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
            </div>
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
