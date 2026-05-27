import { useEffect, useState, useMemo, useRef } from 'react';
import { Icon } from '../terminal/Icon';
import { useProjectStore } from '../../stores/projectStore';

interface OnboardingPanelProps {
  projectPath: string;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
}

const FIRST_PROJECT_KEY = 'onboarding:firstProjectPath';
const SEEDED_TASK_NUMBER_KEY = 'onboarding:seededTaskNumber';
const SEEDED_ON_DEMAND_KEY = 'onboarding:seededOnDemand';
const DISMISSED_KEY = 'onboarding:dismissed';

type Stage = 'intro' | 'setup' | 'in-flight' | 'complete';

/**
 * First-run onboarding banner. Walks the user through configuring a start
 * hook and dragging the seeded tutorial task through the board. Mirrors the
 * task's lifecycle: setup → in-flight (task in_progress) → complete (task in
 * in_review or done). Dismissal is permanent via the ✕ or the final CTA.
 */
export function OnboardingPanel({ projectPath, onConfigureCliAgent, onOpenHelp }: OnboardingPanelProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const startHookConfigured = useProjectStore((s) => !!s.configuredHooks.start);
  const [firstProject, setFirstProject] = useState<string | undefined>(undefined);
  const [seededTaskNumber, setSeededTaskNumber] = useState<number | undefined>(undefined);
  const [seededOnDemand, setSeededOnDemand] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | undefined>(undefined);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.globalSettings.get(FIRST_PROJECT_KEY),
      window.api.globalSettings.get(SEEDED_TASK_NUMBER_KEY),
      window.api.globalSettings.get(SEEDED_ON_DEMAND_KEY),
      window.api.globalSettings.get(DISMISSED_KEY),
    ]).then(([first, taskNum, onDemand, dismissedVal]) => {
      if (cancelled) return;
      setFirstProject(first ?? undefined);
      setSeededTaskNumber(taskNum ? Number(taskNum) : undefined);
      setSeededOnDemand(onDemand === '1');
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
    if (seededTaskNumber == null) return 'intro';
    if (!seededTask) return 'intro';
    if (seededTask.status === 'todo') return 'setup';
    if (seededTask.status === 'in_progress') return 'in-flight';
    return 'complete';
  }, [seededTaskNumber, seededTask]);

  if (firstProject === undefined || dismissed === undefined) return null;
  if (firstProject !== projectPath) return null;
  if (dismissed) return null;
  if (stage === null) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await window.api.globalSettings.set(DISMISSED_KEY, '1');
  };

  const handleSeedPracticeTask = async () => {
    if (seeding) return;
    setSeeding(true);
    await window.api.onboarding.seedTask(projectPath);
    await useProjectStore.getState().loadTasks(projectPath);
    const taskNum = await window.api.globalSettings.get(SEEDED_TASK_NUMBER_KEY);
    if (taskNum) setSeededTaskNumber(Number(taskNum));
    setSeededOnDemand(true);
    setSeeding(false);
  };

  const renderStageBody = (s: Stage) => (
    <>
      {s === 'intro' && <IntroStage />}
      {s === 'setup' && <SetupStage configured={startHookConfigured} viaIntro={seededOnDemand} />}
      {s === 'in-flight' && <InFlightStage />}
      {s === 'complete' && <CompleteStage />}
      <StageCtas
        stage={s}
        startHookConfigured={startHookConfigured}
        seeding={seeding}
        onConfigureCliAgent={onConfigureCliAgent}
        onOpenHelp={onOpenHelp}
        onDismiss={handleDismiss}
        onSeedPracticeTask={handleSeedPracticeTask}
      />
    </>
  );

  return (
    <div
      className="mx-3 mt-3 mb-2 px-4 py-3 rounded-[12px] border border-white/10 flex items-start gap-3 onboarding-stage-enter"
      style={{ background: 'rgba(255, 255, 255, 0.03)' }}
    >
      <div className="flex-1 min-w-0">
        <StageCrossfade stage={stage} renderStage={renderStageBody} />
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

/**
 * Crossfades between stages: old stage runs its exit animation while the new
 * stage renders in the same grid cell with its entrance animation. The grid
 * sizes the container to the max of the two children's heights during the
 * overlap, so the parent height changes smoothly as old shrinks and new grows.
 */
function StageCrossfade({ stage, renderStage }: { stage: Stage; renderStage: (s: Stage) => React.ReactNode }) {
  const [exiting, setExiting] = useState<Stage | null>(null);
  const prevStage = useRef(stage);

  useEffect(() => {
    if (prevStage.current !== stage) {
      const old = prevStage.current;
      setExiting(old);
      const t = setTimeout(() => setExiting((s) => (s === old ? null : s)), 200);
      prevStage.current = stage;
      return () => clearTimeout(t);
    }
  }, [stage]);

  return (
    <div className="grid">
      {exiting && (
        <div key={`exit-${exiting}`} className="[grid-area:1/1] onboarding-stage-exit">
          {renderStage(exiting)}
        </div>
      )}
      <div key={`enter-${stage}`} className="[grid-area:1/1] onboarding-stage-children-enter">
        {renderStage(stage)}
      </div>
    </div>
  );
}

interface StageCtasProps {
  stage: Stage;
  startHookConfigured: boolean;
  seeding: boolean;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
  onDismiss: () => void;
  onSeedPracticeTask: () => void;
}

function StageCtas({
  stage,
  startHookConfigured,
  seeding,
  onConfigureCliAgent,
  onOpenHelp,
  onDismiss,
  onSeedPracticeTask,
}: StageCtasProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap mt-4">
      {stage === 'intro' && (
        <button
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out disabled:opacity-60"
          onClick={onSeedPracticeTask}
          disabled={seeding}
        >
          <Icon name="plus" className="w-3.5 h-3.5" />
          {seeding ? 'Adding…' : 'Try a practice task'}
        </button>
      )}
      {stage === 'complete' && (
        <button
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out"
          onClick={onDismiss}
        >
          Got it
        </button>
      )}
      {(stage === 'setup' || stage === 'in-flight') && (
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
        {stage === 'complete' || stage === 'intro' ? 'Help & setup' : 'Need help?'}
      </button>
      {(stage === 'complete' || stage === 'intro') && (
        <button
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
          onClick={() => window.api.openExternal('https://ouijit.com/docs')}
        >
          <Icon name="file-text" className="w-3.5 h-3.5" />
          Docs
        </button>
      )}
    </div>
  );
}

function StepBadge({ done, number }: { done: boolean; number: number }) {
  const [popping, setPopping] = useState(false);
  const prevDone = useRef(done);

  useEffect(() => {
    if (!prevDone.current && done) {
      setPopping(true);
      const timeout = setTimeout(() => setPopping(false), 320);
      return () => clearTimeout(timeout);
    }
    prevDone.current = done;
  }, [done]);

  return (
    <span
      className={`relative shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors duration-300 ease-out ${
        done ? 'bg-accent text-white' : 'bg-white/10 text-text-primary'
      } ${popping ? 'onboarding-badge-check' : ''}`}
    >
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out ${done ? 'opacity-0' : 'opacity-100'}`}
      >
        {number}
      </span>
      <span
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ease-out [&>svg]:w-3 [&>svg]:h-3 ${done ? 'opacity-100' : 'opacity-0'}`}
      >
        <Icon name="check" />
      </span>
    </span>
  );
}

function IntroStage() {
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <StepBadge done={true} number={0} />
        <div className="text-xs text-text-primary">Added your first project</div>
      </div>
      <ul className="flex flex-col gap-1.5 text-xs text-text-secondary leading-relaxed mb-3">
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>Each task gets its own git worktree and branch, so multiple agents can work in parallel.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Each column has a hook (start, continue, review, done) that fires on task transitions and can run any
            command.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Supported agents automatically get the{' '}
            <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[11px]">ouijit</code> CLI in their context,
            so they know how to see and manage tasks, hooks, tags, plans, and scripts.
          </span>
        </li>
      </ul>
      <div className="text-xs text-text-tertiary leading-relaxed">
        A practice task adds one card with a throwaway prompt. It runs on its own branch and writes a single file you
        can delete after.
      </div>
    </>
  );
}

function SetupStage({ configured, viaIntro }: { configured: boolean; viaIntro: boolean }) {
  return (
    <>
      {viaIntro ? (
        <>
          <div className="flex items-center gap-2 mb-4">
            <StepBadge done={true} number={0} />
            <div className="text-xs text-text-primary">Practice task added to To Do</div>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-text-primary mb-1">Welcome to your first project in Ouijit</div>
          <div className="text-xs text-text-secondary leading-relaxed mb-4">
            A tutorial task is waiting below. Complete it end to end to see how Ouijit works:
          </div>
        </>
      )}
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
    <div className="flex items-center gap-2">
      <StepBadge done={true} number={0} />
      <div className="text-xs text-text-primary">
        &ldquo;Your first task&rdquo; is in <span className="font-medium">In Progress</span>
      </div>
    </div>
  );
}

function CompleteStage() {
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <StepBadge done={true} number={0} />
        <div className="text-xs text-text-primary">
          &ldquo;Your first task&rdquo; is in <span className="font-medium">In Review</span>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 text-xs text-text-secondary leading-relaxed">
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Supported agents automatically get the{' '}
            <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[11px]">ouijit</code> CLI in their context,
            so they know how to see and manage tasks, hooks, tags, plans, and scripts.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-text-tertiary shrink-0">•</span>
          <span>
            Each column has its own hook (start, continue, review, done) that fires on task transitions and can run any
            command.
          </span>
        </li>
      </ul>
    </>
  );
}
