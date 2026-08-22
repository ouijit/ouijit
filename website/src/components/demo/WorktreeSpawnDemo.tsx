import { useRef, useState } from 'react';
import type { TaskWithWorkspace } from '../../ouijit-ui/types';
import { KanbanColumnView } from '../../ouijit-ui/components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../ouijit-ui/components/kanban/KanbanCardView';
import type { TerminalDisplayState } from '../../ouijit-ui/terminalDisplay';
import { DEFAULT_DISPLAY_STATE } from '../../ouijit-ui/terminalDisplay';
import { useInView, useLoop } from './choreo';

const PROJECT_PATH = '/demo/horizon';

function task(taskNumber: number, name: string, status: TaskWithWorkspace['status'], branch?: string): TaskWithWorkspace {
  return {
    taskNumber,
    name,
    status,
    branch,
    worktreePath: branch ? `${PROJECT_PATH}/.ouijit/worktrees/T-${taskNumber}` : undefined,
    createdAt: '2026-05-08T09:00:00Z',
  };
}

const MOVING_TODO = task(118, 'Wire payment retries to dunning queue', 'todo');
const MOVING_LANDED = task(118, 'Wire payment retries to dunning queue', 'in_progress', 'wire-payment-retries');

const TODO_REST: TaskWithWorkspace[] = [
  task(117, 'Add CSV export to invoices table', 'todo'),
  task(116, 'Bump deps for security advisory', 'todo'),
  task(115, 'Add rate limits to the invite API', 'todo'),
];

const IN_PROGRESS: TaskWithWorkspace[] = [
  task(103, 'Polish invitation email', 'in_progress', 'polish-invitation-email'),
  task(105, 'Audit accessibility on settings dialog', 'in_progress', 'a11y-settings'),
];

function term(partial: Partial<TerminalDisplayState> & { ptyId: string }): TerminalDisplayState {
  return { ...DEFAULT_DISPLAY_STATE, projectPath: PROJECT_PATH, ...partial };
}

const BASE_TERMINALS: Record<number, TerminalDisplayState[]> = {
  103: [term({ ptyId: 'pty-103', label: 'claude', summaryType: 'ready', lastOscTitle: 'awaiting input', taskId: 103 })],
  105: [
    term({ ptyId: 'pty-105', label: 'claude', summaryType: 'thinking', lastOscTitle: 'Investigating contrast…', taskId: 105 }),
  ],
};

type Stage = 'rest' | 'lift' | 'fly' | 'landed';

interface Ghost {
  x: number;
  y: number;
  w: number;
  dx: number;
  dy: number;
  moving: boolean;
}

/**
 * A card drags itself from To Do to In Progress; the worktree spins up and a
 * claude terminal attaches — the moment the section's copy describes.
 */
export default function WorktreeSpawnDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const containerRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [stage, setStage] = useState<Stage>('rest');
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const [spawnedOsc, setSpawnedOsc] = useState<string | null>(null);

  useLoop(inView, (at) => {
    setStage('rest');
    setGhost(null);
    setSettingUp(false);
    setSpawnedOsc(null);

    at(900, () => setStage('lift'));
    at(1600, () => {
      const src = liftRef.current?.getBoundingClientRect();
      const dst = dropRef.current?.getBoundingClientRect();
      const box = containerRef.current?.getBoundingClientRect();
      // The To Do column is hidden on narrow screens; land directly then.
      if (!src || !dst || !box || src.width < 10) {
        setStage('landed');
        setSettingUp(true);
        return;
      }
      setGhost({
        x: src.left - box.left,
        y: src.top - box.top,
        w: src.width,
        dx: dst.left - box.left - (src.left - box.left),
        dy: dst.top - box.top - (src.top - box.top),
        moving: false,
      });
      setStage('fly');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setGhost((g) => (g ? { ...g, moving: true } : g))),
      );
    });
    at(2350, () => {
      setGhost(null);
      setStage('landed');
      setSettingUp(true);
    });
    at(3500, () => {
      setSettingUp(false);
      setSpawnedOsc('Spinning up…');
    });
    at(4700, () => setSpawnedOsc('Reading the payment retry queue…'));
    at(7000, () => setSpawnedOsc('Edit src/billing/retries.ts'));
    return 9600;
  });

  const todoTasks = stage === 'rest' || stage === 'lift' ? [MOVING_TODO, ...TODO_REST] : TODO_REST;
  const inProgTasks = stage === 'landed' ? [...IN_PROGRESS, MOVING_LANDED] : IN_PROGRESS;

  const spawnedTerminals: TerminalDisplayState[] = spawnedOsc
    ? [term({ ptyId: 'pty-118', label: 'claude', summaryType: 'thinking', lastOscTitle: spawnedOsc, taskId: 118 })]
    : [];

  return (
    <div ref={sceneRef} className="worktree-demo">
      <div ref={containerRef} className="demo-frame relative flex" style={{ height: 440 }}>
        <KanbanColumnView status="todo" label="To Do" count={todoTasks.length}>
          {todoTasks.map((t) =>
            t.taskNumber === MOVING_TODO.taskNumber ? (
              <div
                key={t.taskNumber}
                ref={liftRef}
                className="worktree-demo-liftable"
                data-lifted={stage === 'lift' || undefined}
              >
                <KanbanCardView task={t} />
              </div>
            ) : (
              <KanbanCardView key={t.taskNumber} task={t} />
            ),
          )}
        </KanbanColumnView>
        <KanbanColumnView status="in_progress" label="In Progress" count={inProgTasks.length}>
          {IN_PROGRESS.map((t) => (
            <KanbanCardView key={t.taskNumber} task={t} connectedDisplays={BASE_TERMINALS[t.taskNumber]} />
          ))}
          {stage === 'landed' && (
            <div className="workspace-scene-task-pulse">
              <KanbanCardView task={MOVING_LANDED} isSettingUp={settingUp} connectedDisplays={spawnedTerminals} />
            </div>
          )}
          <div ref={dropRef} />
        </KanbanColumnView>

        {ghost && (
          <div
            className="worktree-demo-ghost"
            style={{
              left: ghost.x,
              top: ghost.y,
              width: ghost.w,
              transform: ghost.moving
                ? `translate(${ghost.dx}px, ${ghost.dy}px) scale(1)`
                : 'translate(0, 0) scale(1.035) rotate(1.2deg)',
            }}
          >
            <KanbanCardView task={MOVING_TODO} />
          </div>
        )}
      </div>
    </div>
  );
}
