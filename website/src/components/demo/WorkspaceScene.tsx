import type { TaskStatus } from '@app/types';
import { KanbanColumnView } from '@app/components/kanban/KanbanColumnView';
import { KanbanCardView } from '@app/components/kanban/KanbanCardView';
import { KanbanBadgeView } from '@app/components/kanban/KanbanBadgeView';
import { TerminalCardView } from '@app/components/terminal/TerminalCardView';
import { TerminalHeaderView } from '@app/components/terminal/TerminalHeaderView';
import { isChainMember } from '@app/utils/taskChain';
import { featuresTasks, featuresChainMap, featuresTerminalsByTask } from './featuresFixtures';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'done', label: 'Done' },
];

/**
 * The features-page hero. A 4-column kanban board sits at the top of the
 * frame; a terminal stack belonging to one in-progress task overlaps the
 * board's lower-left corner and trails below the board's bottom edge,
 * giving the composition a non-rectangular silhouette.
 *
 * The active terminal in the stack matches the focal task on the board
 * (T-101 "Rework onboarding flow") so the visual reads as one workspace,
 * not two unrelated mocks.
 */
export default function WorkspaceScene() {
  return (
    <div
      className="workspace-scene"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 1160,
        margin: '0 auto',
        height: 630,
      }}
    >
      {/* Board layer — matches the app's .kanban-board (glass-bevel + black border + rounded). */}
      <div
        className="workspace-scene-board glass-bevel"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 560,
          display: 'flex',
          background: 'var(--color-background)',
          border: '1px solid rgba(0, 0, 0, 0.6)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.7)',
        }}
      >
        {COLUMNS.map(({ status, label }) => {
          const tasksInColumn = featuresTasks.filter((t) => t.status === status);
          return (
            <KanbanColumnView key={status} status={status} label={label} count={tasksInColumn.length}>
              {tasksInColumn.map((task) => {
                const chainInfo = featuresChainMap.get(task.taskNumber);
                const showBadge = isChainMember(chainInfo);
                return (
                  <KanbanCardView
                    key={task.taskNumber}
                    task={task}
                    connectedDisplays={featuresTerminalsByTask[task.taskNumber] ?? []}
                    chainInfo={chainInfo}
                    showBadge={showBadge}
                    badge={
                      showBadge ? <KanbanBadgeView taskNumber={task.taskNumber} chainInfo={chainInfo} /> : null
                    }
                  />
                );
              })}
            </KanbanColumnView>
          );
        })}
      </div>

      {/* Terminal stack layer — overlaps the board's bottom-right corner and
          juts past the right edge so the combined silhouette is non-rectangular. */}
      <div
        className="workspace-scene-stack"
        style={{
          position: 'absolute',
          right: -40,
          bottom: 0,
          width: 720,
          zIndex: 2,
          filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.6))',
        }}
      >
        <div style={{ position: 'relative', height: 450, paddingTop: 80 }}>
          {/* Back card 3 */}
          <TerminalCardView backDepth={3}>
            <TerminalHeaderView
              summaryType="ready"
              stackPosition={3}
              isBackCard
              label="shell"
              summary="zsh"
            />
          </TerminalCardView>
          {/* Back card 2 */}
          <TerminalCardView backDepth={2}>
            <TerminalHeaderView
              summaryType="ready"
              stackPosition={2}
              isBackCard
              label="npm test"
              summary="14 passed"
            />
          </TerminalCardView>
          {/* Back card 1 */}
          <TerminalCardView backDepth={1}>
            <TerminalHeaderView
              summaryType="ready"
              stackPosition={1}
              isBackCard
              label="npm run dev"
              summary="live dev server"
            />
          </TerminalCardView>
          {/* Front (active) card */}
          <TerminalCardView isActive>
            <TerminalHeaderView
              summaryType="thinking"
              isActive
              label="claude"
              summary="Editing onboarding stepper..."
              tags={['onboarding', 'stepper']}
              actions={
                <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
                  <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-accent text-white">
                    Plan
                  </button>
                  <div aria-hidden className="w-px h-3 bg-white/10 self-center" />
                  <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-transparent text-text-secondary">
                    Run
                  </button>
                </div>
              }
            />
            <div className="flex-1 grid grid-cols-2 min-h-0">
              <div className="p-4 font-mono text-[11px] leading-6 text-white/85 border-r border-white/[0.06] overflow-hidden">
                <div>
                  <span className="text-white/40 mr-1">{'>'}</span> Split onboarding into a three-step stepper with saved
                  progress.
                </div>
                <div className="mt-1.5 text-white">
                  <span className="bg-accent/15 text-[#79b8ff] px-1.5 rounded mr-1">Edit</span>
                  src/onboarding/Stepper.tsx
                </div>
                <div className="text-white/55 pl-3">└─ +124 lines, persists progress, adds back affordance</div>
                <div className="mt-1.5 text-white">
                  <span className="bg-accent/15 text-[#79b8ff] px-1.5 rounded mr-1">Bash</span>
                  npm test onboarding
                </div>
                <div className="text-white/55 pl-3">
                  └─ <span className="text-[#4ee82e]">14 passed</span>, 0 failed
                </div>
                <div className="mt-2 text-white/40">· Thinking...</div>
              </div>
              <div className="p-4 bg-background-secondary text-white text-xs">
                <div className="text-sm font-semibold mb-2">Rework onboarding flow</div>
                <div className="text-[11px] font-semibold mb-1 mt-3">Outcome</div>
                <p className="text-white/55 text-[11px] leading-relaxed">
                  Three step stepper that persists progress per user. Pick up where you left off.
                </p>
                <div className="text-[11px] font-semibold mb-1 mt-3">Steps</div>
                <ol className="pl-4 text-white/55 text-[11px] leading-relaxed list-decimal">
                  <li>Extract each section into its own screen.</li>
                  <li>Persist progress per user under the onboarding key.</li>
                  <li>Header level Stepper with back/next.</li>
                  <li>Reusable WelcomeIntro component.</li>
                </ol>
              </div>
            </div>
          </TerminalCardView>
        </div>
      </div>
    </div>
  );
}
