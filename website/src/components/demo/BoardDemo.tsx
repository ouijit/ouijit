import { KanbanColumnView } from '@app/components/kanban/KanbanColumnView';
import { KanbanCardView } from '@app/components/kanban/KanbanCardView';
import { KanbanBadgeView } from '@app/components/kanban/KanbanBadgeView';
import { isChainMember } from '@app/utils/taskChain';
import { demoTasks, demoTerminalsByTask, demoChainMap } from './fixtures';

/**
 * Marketing-only wrapper that fixes the column to a tasteful width and gives
 * its body a finite height + overflow, so the demo shows what an active column
 * looks like when it's full and scrolling, without trying to fill the visual
 * grid track. Mirrors the behavior of the in-app KanbanColumn body which uses
 * `overflow-y-auto flex-1 min-h-0` inside the kanban viewport.
 */
export default function BoardDemo() {
  return (
    <div className="demo-frame" style={{ display: 'flex', height: 540, width: '100%', maxWidth: 440 }}>
      <KanbanColumnView status="in_progress" label="In Progress" count={demoTasks.length}>
        {demoTasks.map((task) => {
          const chainInfo = demoChainMap.get(task.taskNumber);
          const showBadge = isChainMember(chainInfo);
          return (
            <KanbanCardView
              key={task.taskNumber}
              task={task}
              connectedDisplays={demoTerminalsByTask[task.taskNumber] ?? []}
              showBadge={showBadge}
              badge={
                showBadge ? <KanbanBadgeView taskNumber={task.taskNumber} chainInfo={chainInfo} /> : null
              }
            />
          );
        })}
      </KanbanColumnView>
    </div>
  );
}
