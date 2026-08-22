import { useEffect, useRef, useState } from 'react';
import type { TaskStatus } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import { KanbanAddInput } from '../../ouijit-ui/components/kanban/KanbanAddInput';
import { Icon } from '../../ouijit-ui/components/terminal/Icon';
import { featuresTasks, featuresTerminalsByTask } from './featuresFixtures';

const COLUMNS: { status: TaskStatus; label: string; hooked: boolean }[] = [
  { status: 'todo', label: 'To Do', hooked: false },
  { status: 'in_progress', label: 'In Progress', hooked: true },
  { status: 'in_review', label: 'In Review', hooked: true },
  { status: 'done', label: 'Done', hooked: false },
];

const CANVAS_WIDTH = 1240;
const CANVAS_HEIGHT = 800;
const MIN_SCALE = 0.62;

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
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setScale(computeScale(entries[0].contentRect.width)));
    observer.observe(el);
    setScale(computeScale(el.getBoundingClientRect().width));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <div className="app-window-titlebar">
            <div className="app-window-lights" aria-hidden="true">
              <span style={{ background: '#ff5f57' }} />
              <span style={{ background: '#febc2e' }} />
              <span style={{ background: '#28c840' }} />
            </div>
            <div className="app-window-project">
              <span className="app-window-avatar">HO</span>
              <span className="app-window-project-text">
                <span className="app-window-project-name">horizon</span>
                <span className="app-window-project-path">~/Code/horizon</span>
              </span>
            </div>
            <div className="app-window-controls">
              <div className="app-window-seg">
                <span className="app-window-seg-btn" data-active>
                  <Icon name="grid-four" />
                </span>
                <span className="app-window-seg-btn">
                  <Icon name="cards-three" />
                </span>
                <span className="app-window-seg-btn">
                  <Icon name="gear" />
                </span>
              </div>
              <span className="app-window-round-btn">
                <Icon name="terminal" />
              </span>
              <span className="app-window-round-btn">
                <Icon name="plus" />
              </span>
            </div>
          </div>
          <div className="app-window-body">
            <div className="app-window-sidebar">
              <img src="/assets/ouijit-glyph.svg" alt="" width={26} height={29} />
              <span className="app-window-sidebar-divider" />
              <span className="app-window-sidebar-project" data-active>
                <span className="app-window-avatar">HO</span>
                <span className="app-window-sidebar-badge">5</span>
              </span>
              <span className="app-window-sidebar-add">
                <Icon name="plus" />
              </span>
              <span className="app-window-sidebar-foot">
                <Icon name="sidebar-simple" />
              </span>
            </div>
            <div className="app-window-board">
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
                  >
                    {tasksInColumn.map((task) => (
                      <KanbanCardView
                        key={task.taskNumber}
                        task={task}
                        connectedDisplays={featuresTerminalsByTask[task.taskNumber] ?? []}
                        showBadge={false}
                      />
                    ))}
                    {status === 'todo' && (
                      <>
                        <div style={{ flex: 1 }} />
                        <KanbanAddInput onAdd={() => {}} />
                      </>
                    )}
                  </KanbanColumnView>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
