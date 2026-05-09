import { useCallback, useState, type ReactNode } from 'react';
import type { TaskStatus } from '@app/types';
import { KanbanColumnView } from '@app/components/kanban/KanbanColumnView';
import { KanbanCardView } from '@app/components/kanban/KanbanCardView';
import { KanbanBadgeView } from '@app/components/kanban/KanbanBadgeView';
import { KanbanAddInput } from '@app/components/kanban/KanbanAddInput';
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
    label: 'Polish invitation email',
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
              {status === 'todo' && <KanbanAddInput onAdd={() => {}} />}
            </KanbanColumnView>
          );
        })}
      </div>

      {/* Top-right: macOS-style notification preview. Mirrors where macOS
          actually posts notifications. Clicking the banner brings the
          matching terminal to the front of the stack, just like the OS
          notification opens the source app. */}
      <div
        className="workspace-scene-notification"
        style={{
          position: 'absolute',
          top: 24,
          right: -15,
          width: 270,
          zIndex: 3,
        }}
      >
        <NotificationPreview onActivate={() => bringToFront('pty-103-test')} />
      </div>

      {/* Bottom-left: CLI prompt bubble. Sits near the todo column where new
          tasks land, and reinforces that the same workflow can be driven
          from the shell — agents (and people) can spin up tasks without
          touching the UI. */}
      <div
        className="workspace-scene-cli"
        style={{
          position: 'absolute',
          left: 30,
          bottom: 50,
          width: 360,
          zIndex: 3,
        }}
      >
        <CliPromptBubble />
      </div>

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

/** Static action group mirroring the app's ActionGroup: Plan, Preview, Diff,
 * Run + chevron. All idle (no panels open) so each button shows its inactive
 * style. */
function ActiveActions() {
  const btn =
    'h-full px-2.5 flex items-center gap-1 border-none font-sans text-[13px] font-medium bg-transparent text-text-secondary hover:text-text-primary hover:bg-background-tertiary';
  const divider = <div aria-hidden className="w-px h-3 bg-white/10 self-center" />;
  return (
    <div className="inline-flex items-center h-7 bg-background-secondary glass-bevel relative border border-black/60 rounded-[12px] overflow-hidden">
      <button className={btn}>
        <Icon name="list-checks" className="w-3.5 h-3.5" />
        <span>Plan</span>
      </button>
      {divider}
      <button className={btn}>
        <Icon name="globe-simple" className="w-3.5 h-3.5" />
        <span>Preview</span>
      </button>
      {divider}
      <button className={btn}>
        <span>3 files</span>
        <span className="text-[#4ee82e]">+124</span>
        <span className="text-[#ff6b6b]">-18</span>
      </button>
      {divider}
      <button className={btn}>
        <span>Run</span>
      </button>
      <button className={`${btn} !px-2`} aria-label="More run options">
        <Icon name="caret-down" className="w-2.5 h-2.5" />
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

/** Floating glass pill mimicking a quick CLI invocation. Static visual — the
 * cursor block blinks via CSS so the pill feels alive without animating
 * actual typed characters. */
function CliPromptBubble() {
  return (
    <div className="cli-prompt-bubble">
      <span className="cli-prompt-bubble__prompt">$</span>
      <span className="cli-prompt-bubble__cmd">
        <span className="cli-prompt-bubble__bin">ouijit</span> task create-and-start{' '}
        <span className="cli-prompt-bubble__arg">&quot;Add 2FA&quot;</span>
      </span>
      <span className="cli-prompt-bubble__cursor" aria-hidden="true" />
    </div>
  );
}

/** macOS dark-mode notification banner mimicking the one Ouijit posts via
 * `new Notification(projectName, { body })` when a terminal goes ready.
 * Clicking the banner activates the matching terminal (like the OS banner
 * opening the source app); hovering reveals a close button in the top-left
 * that dismisses the notification without activating it. */
function NotificationPreview({ onActivate }: { onActivate?: () => void }) {
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
          Polish invitation email is ready
        </div>
      </div>
    </div>
  );
}
