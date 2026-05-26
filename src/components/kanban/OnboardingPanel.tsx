import { useEffect, useState, useMemo } from 'react';
import { Icon } from '../terminal/Icon';
import { useProjectStore } from '../../stores/projectStore';

interface OnboardingPanelProps {
  projectPath: string;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
}

const SEEDED_PROJECT_KEY = 'onboarding:seededProject';
const SEEDED_TASK_NUMBER_KEY = 'onboarding:seededTaskNumber';
const DISMISSED_KEY = 'onboarding:dismissed';

type Stage = 'setup' | 'in-flight' | 'complete';

/**
 * First-run onboarding banner. Walks the user through configuring a start
 * hook and dragging the seeded tutorial task through the board. Mirrors the
 * task's lifecycle: setup → in-flight (task in_progress) → complete (task in
 * in_review or done). Dismissal is permanent via the ✕ or the final CTA.
 */
export function OnboardingPanel({ projectPath, onConfigureCliAgent, onOpenHelp }: OnboardingPanelProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const startHookConfigured = useProjectStore((s) => !!s.configuredHooks.start);
  const [seededProject, setSeededProject] = useState<string | undefined>(undefined);
  const [seededTaskNumber, setSeededTaskNumber] = useState<number | undefined>(undefined);
  const [dismissed, setDismissed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.globalSettings.get(SEEDED_PROJECT_KEY),
      window.api.globalSettings.get(SEEDED_TASK_NUMBER_KEY),
      window.api.globalSettings.get(DISMISSED_KEY),
    ]).then(([seeded, taskNum, dismissedVal]) => {
      if (cancelled) return;
      setSeededProject(seeded ?? undefined);
      setSeededTaskNumber(taskNum ? Number(taskNum) : undefined);
      setDismissed(dismissedVal === '1');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const seededTask = useMemo(
    () => (seededTaskNumber != null ? tasks.find((t) => t.taskNumber === seededTaskNumber) : undefined),
    [tasks, seededTaskNumber],
  );

  const stage: Stage | null = useMemo(() => {
    if (!seededTask) return 'setup';
    if (seededTask.status === 'todo') return 'setup';
    if (seededTask.status === 'in_progress') return 'in-flight';
    return 'complete';
  }, [seededTask]);

  if (seededProject === undefined || dismissed === undefined) return null;
  if (seededProject !== projectPath) return null;
  if (dismissed) return null;
  if (stage === null) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await window.api.globalSettings.set(DISMISSED_KEY, '1');
  };

  return (
    <div
      className="mx-3 mt-3 mb-2 px-4 py-3 rounded-[12px] border border-white/10 flex items-start gap-3"
      style={{ background: 'rgba(255, 255, 255, 0.03)' }}
    >
      <div className="flex-1 min-w-0">
        {stage === 'setup' && <SetupStage configured={startHookConfigured} />}
        {stage === 'in-flight' && <InFlightStage />}
        {stage === 'complete' && <CompleteStage />}

        <div className="flex items-center gap-2 flex-wrap mt-4">
          {stage === 'complete' ? (
            <button
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out"
              onClick={handleDismiss}
            >
              Got it
            </button>
          ) : (
            <button
              className={`inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full active:scale-[0.98] transition-all duration-150 ease-out ${
                startHookConfigured
                  ? 'text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary'
                  : 'text-white bg-accent hover:bg-accent-hover'
              }`}
              onClick={onConfigureCliAgent}
            >
              <Icon name="terminal" className="w-3.5 h-3.5" />
              {startHookConfigured ? 'Edit start hook' : 'Configure start hook'}
            </button>
          )}
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
            onClick={onOpenHelp}
          >
            <Icon name="question" className="w-3.5 h-3.5" />
            {stage === 'complete' ? 'Help & setup' : 'Need help?'}
          </button>
        </div>
      </div>
      <button
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/10 transition-colors [&>svg]:w-4 [&>svg]:h-4"
        onClick={handleDismiss}
        aria-label="Dismiss onboarding"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

function StepBadge({ done, number }: { done: boolean; number: number }) {
  return (
    <span
      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold ${
        done ? 'bg-accent text-white [&>svg]:w-3 [&>svg]:h-3' : 'bg-white/10 text-text-primary'
      }`}
    >
      {done ? <Icon name="check" /> : number}
    </span>
  );
}

function SetupStage({ configured }: { configured: boolean }) {
  return (
    <>
      <div className="text-sm font-semibold text-text-primary mb-1">Welcome to your first project in Ouijit</div>
      <div className="text-xs text-text-secondary leading-relaxed mb-4">
        A tutorial task is waiting below. Complete it end to end to see how Ouijit works:
      </div>
      <ol className="flex flex-col gap-3">
        <li className="flex gap-3">
          <StepBadge done={configured} number={1} />
          <div className={`min-w-0 ${configured ? 'opacity-50' : ''}`}>
            <div className="text-xs font-medium text-text-primary mb-1">Configure a start hook</div>
            <div className="text-xs text-text-secondary leading-relaxed mb-2">
              The command Ouijit runs when a task enters In Progress. For example:
            </div>
            <div className="flex">
              <code className="inline-block font-mono text-[12px] text-text-primary bg-white/5 rounded-md px-2.5 py-1.5 max-w-full overflow-x-auto whitespace-nowrap">
                {`claude "complete the current task and move it to in-review"`}
              </code>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <StepBadge done={false} number={2} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary mb-1">
              Drag &ldquo;Your first task&rdquo; to In Progress
            </div>
            <div className="text-xs text-text-secondary leading-relaxed">
              Your agent picks up the task and drives the board from there.
            </div>
          </div>
        </li>
      </ol>
    </>
  );
}

function InFlightStage() {
  return (
    <>
      <div className="text-sm font-semibold text-text-primary mb-1">Your agent is working</div>
      <div className="text-xs text-text-secondary leading-relaxed mb-4">
        Watch the tutorial task move across the board as your agent runs it.
      </div>
      <ol className="flex flex-col gap-3">
        <li className="flex gap-3 opacity-50">
          <StepBadge done={true} number={1} />
          <div className="min-w-0 pt-0.5">
            <div className="text-xs font-medium text-text-primary">Start hook configured</div>
          </div>
        </li>
        <li className="flex gap-3 opacity-50">
          <StepBadge done={true} number={2} />
          <div className="min-w-0 pt-0.5">
            <div className="text-xs font-medium text-text-primary">Tutorial task started</div>
          </div>
        </li>
      </ol>
    </>
  );
}

function CompleteStage() {
  return (
    <>
      <div className="text-sm font-semibold text-text-primary mb-3">Your agent moved the task to In Review</div>
      <ul className="flex flex-col gap-1.5 text-xs text-text-secondary leading-relaxed">
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Supported agents automatically get the{' '}
            <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[11px]">ouijit</code> CLI in their context,
            so they know how to see and manage tasks, hooks, tags, plans, and scripts. The same commands are available
            to you in any terminal.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Each column has its own hook (start, continue, review, done) that fires on task transitions and can run any
            command.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>Each task lives in its own git worktree and branch, so multiple agents can work in parallel.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>Task descriptions support multiple lines, images, and attached files.</span>
        </li>
      </ul>
    </>
  );
}
