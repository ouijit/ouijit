import { useCallback, useState, type ReactNode } from 'react';
import type { TaskStatus } from '@app/types';
import { KanbanColumnView } from '@app/components/kanban/KanbanColumnView';
import { KanbanCardView } from '@app/components/kanban/KanbanCardView';
import { KanbanBadgeView } from '@app/components/kanban/KanbanBadgeView';
import { TerminalCardView } from '@app/components/terminal/TerminalCardView';
import { TerminalHeaderView } from '@app/components/terminal/TerminalHeaderView';
import { Icon } from '@app/components/terminal/Icon';
import { isChainMember } from '@app/utils/taskChain';
import { featuresTasks, featuresChainMap, featuresTerminalsByTask } from './featuresFixtures';

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
  body: ReactNode;
}

const TERMINALS: StackTerminal[] = [
  {
    ptyId: 'pty-101-claude',
    label: 'Rework onboarding flow',
    summaryType: 'thinking',
    lastOscTitle: 'Editing onboarding stepper...',
    branch: 'rework-onboarding',
    tags: ['onboarding', 'stepper'],
    body: <ClaudeBody />,
  },
  {
    ptyId: 'pty-101-dev',
    label: 'Rework onboarding flow',
    summaryType: 'ready',
    lastOscTitle: 'live dev server',
    branch: 'rework-onboarding',
    body: <DevServerBody />,
  },
  {
    ptyId: 'pty-103-test',
    label: 'Polish invitation email template',
    summaryType: 'ready',
    lastOscTitle: '14 passed',
    branch: 'polish-invitation-email',
    body: <TestBody />,
  },
  {
    ptyId: 'pty-105-shell',
    label: 'Audit accessibility on settings dialog',
    summaryType: 'ready',
    lastOscTitle: 'axe-core --tags wcag2a',
    branch: 'a11y-settings',
    body: <ShellBody />,
  },
];

/**
 * The features-page hero. A 4-column kanban board sits at the top of the
 * frame; a terminal stack belonging to the in_progress tasks overlaps the
 * board's lower-right corner and trails below the board's bottom edge.
 *
 * Interactive: clicking a back card in the stack promotes that terminal to
 * the front, and clicking a terminal pill on a kanban card brings the
 * matching terminal to the front of the stack.
 */
export default function WorkspaceScene() {
  const [stackOrder, setStackOrder] = useState<string[]>(() => TERMINALS.map((t) => t.ptyId));

  const bringToFront = useCallback((ptyId: string) => {
    setStackOrder((prev) => (prev[0] === ptyId ? prev : [ptyId, ...prev.filter((id) => id !== ptyId)]));
  }, []);

  // Each terminal's stack depth comes from stackOrder, but we render them in
  // a stable DOM order so React never has to reorder children. Reordering
  // would re-attach one of the cards and cancel its CSS transition mid-flight.
  // The visual stacking is handled entirely by zIndex/transform from
  // TerminalCardView's DEPTH_STYLES.
  const positionByPtyId = new Map(stackOrder.map((id, i) => [id, i]));

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
                    onSwitchToTerminal={bringToFront}
                  />
                );
              })}
            </KanbanColumnView>
          );
        })}
      </div>

      {/* Terminal stack layer. */}
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
          {TERMINALS.map((term) => {
            const position = positionByPtyId.get(term.ptyId) ?? 0;
            const isActive = position === 0;
            return (
              <TerminalCardView
                key={term.ptyId}
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
                  label={term.label}
                  lastOscTitle={term.lastOscTitle}
                  tags={isActive ? term.tags : undefined}
                  branchContent={isActive && term.branch ? <BranchLabel branch={term.branch} /> : undefined}
                  actions={isActive ? <ActiveActions /> : undefined}
                />
                {isActive && term.body}
              </TerminalCardView>
            );
          })}
        </div>
      </div>
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

/** Static Plan/Run action pair, visual only. */
function ActiveActions() {
  return (
    <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
      <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-accent text-white">
        Plan
      </button>
      <div aria-hidden className="w-px h-3 bg-white/10 self-center" />
      <button className="h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-transparent text-text-secondary">
        Run
      </button>
    </div>
  );
}

const BODY_CLS = 'flex-1 p-4 font-mono text-[11px] leading-6 text-white/85 overflow-hidden min-h-0';

function ClaudeBody() {
  return (
    <div className={BODY_CLS}>
      <div>
        <span className="text-white/40 mr-1">{'>'}</span> Split onboarding into a three-step stepper with saved progress.
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
  );
}

function DevServerBody() {
  return (
    <div className={BODY_CLS}>
      <div className="text-white/55">VITE v5.4.10  ready in 412 ms</div>
      <div className="mt-2">
        <span className="text-[#79b8ff]">{'>'}</span> Local: <span className="text-white/55">http://localhost:5173/</span>
      </div>
      <div>
        <span className="text-[#79b8ff]">{'>'}</span> Network: <span className="text-white/55">use --host to expose</span>
      </div>
      <div className="mt-3 text-white/40">14:32:18 [vite] hmr update /src/onboarding/Stepper.tsx</div>
      <div className="text-white/40">14:32:21 [vite] hmr update /src/onboarding/WelcomeIntro.tsx</div>
      <div className="text-white/40">14:32:34 [vite] page reload (saved-progress hook)</div>
    </div>
  );
}

function TestBody() {
  return (
    <div className={BODY_CLS}>
      <div className="text-white/55">$ vitest run email</div>
      <div className="mt-2">
        <span className="text-[#4ee82e]">{'✓'}</span> templates/invitation.test.ts (8 tests)
      </div>
      <div className="text-white/55 pl-3">└─ subject line, body html, plain-text fallback, design tokens</div>
      <div className="mt-1">
        <span className="text-[#4ee82e]">{'✓'}</span> templates/styles.test.ts (6 tests)
      </div>
      <div className="text-white/55 pl-3">└─ resolves the new button styles</div>
      <div className="mt-2 text-white/55">Test Files  2 passed (2)</div>
      <div className="text-white/55">
        Tests       <span className="text-[#4ee82e]">14 passed</span> (14)
      </div>
      <div className="text-white/55">Duration    1.12s</div>
    </div>
  );
}

function ShellBody() {
  return (
    <div className={BODY_CLS}>
      <div className="text-white/55">$ npx axe-core --tags wcag2a src/components/SettingsDialog.tsx</div>
      <div className="mt-2 text-[#ffb454]">! aria-required-parent</div>
      <div className="text-white/55 pl-3">└─ tab role missing tablist parent (line 84)</div>
      <div className="mt-2 text-[#ffb454]">! color-contrast</div>
      <div className="text-white/55 pl-3">└─ secondary text 3.8:1 (needs 4.5:1)</div>
      <div className="mt-2">
        <span className="text-[#4ee82e]">{'✓'}</span> 38 checks passed
      </div>
      <div className="text-white/55">2 issues to address</div>
    </div>
  );
}
