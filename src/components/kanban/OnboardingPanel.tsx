import { useEffect, useState, useMemo, useRef } from 'react';
import { Icon } from '../terminal/Icon';
import { useProjectStore } from '../../stores/projectStore';
import { useAppStore } from '../../stores/appStore';
import { type OnboardingStorageIO, patchOnboardingState, readOnboardingState } from '../../onboardingState';
import type { FirstProjectSource, OnboardingState } from '../../types';

interface OnboardingPanelProps {
  projectPath: string;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
}

const EXAMPLE_START_HOOK_COMMAND = `claude "complete the current task and move it into in review"`;

type Stage = 'intro' | 'setup' | 'in-flight' | 'complete';

const io: OnboardingStorageIO = {
  get: (key) => window.api.globalSettings.get(key),
  set: (key, value) => window.api.globalSettings.set(key, value),
};

/**
 * First-run onboarding banner. Walks the user through configuring a start
 * hook and dragging the seeded tutorial task through the board. Mirrors the
 * task's lifecycle: setup → in-flight (task in_progress) → complete (task in
 * in_review or done). Dismissal is permanent via the ✕ or the final CTA.
 */
export function OnboardingPanel({ projectPath, onConfigureCliAgent, onOpenHelp }: OnboardingPanelProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const startHookConfigured = useProjectStore((s) => !!s.configuredHooks.start);
  // `undefined` = not yet loaded, `null` = loaded but no state exists yet.
  const [state, setState] = useState<OnboardingState | null | undefined>(undefined);
  // Session-only flags live in the app store so they survive panel unmount
  // (e.g., user toggles the kanban view off and back on). If these were
  // useState they'd reset on every remount, which contradicts "Hide for now"
  // and would lose the stuck-state context too.
  const softDismissed = useAppStore((s) => s.onboardingSoftDismissed);
  const stuckLatched = useAppStore((s) => s.onboardingStuckLatched);
  const setSoftDismissed = useAppStore((s) => s.setOnboardingSoftDismissed);
  const setStuckLatched = useAppStore((s) => s.setOnboardingStuckLatched);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readOnboardingState(io).then((s) => {
      if (cancelled) return;
      setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const seededTaskNumber = state?.seededTaskNumber ?? null;
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

  // "Stuck" = task transitioned into in_progress without a start hook
  // configured, so nothing actually fired. We latch this so re-configuring
  // the hook after the fact doesn't silently flip the stage display — the
  // user still needs to drag back and forward to retrigger.
  //
  // The latch is set only on a real stage TRANSITION into 'in-flight'.
  // Checking just `stage === 'in-flight'` on first render would falsely
  // latch when the panel mounts with a task already in_progress (e.g., after
  // an app restart) before the project's configuredHooks have loaded from
  // the store — startHookConfigured is briefly `false` even when the hook
  // exists. Tracking the previous stage closes that window.
  const prevStageRef = useRef<Stage | undefined>(undefined);
  useEffect(() => {
    const prev = prevStageRef.current;
    prevStageRef.current = stage;
    if (prev !== undefined && prev !== 'in-flight' && stage === 'in-flight' && !startHookConfigured) {
      setStuckLatched(true);
    }
    if (stage === 'setup' || stage === 'intro' || stage === 'complete') {
      // Task moved out of in_progress: clear the latch so a subsequent
      // forward drag re-evaluates cleanly.
      if (stuckLatched) setStuckLatched(false);
    }
  }, [stage, startHookConfigured, stuckLatched, setStuckLatched]);

  if (state === undefined) return null;
  if (!state || state.firstProjectPath !== projectPath) return null;
  if (state.dismissed || softDismissed) return null;
  if (stage === null) return null;

  const handleDismiss = async () => {
    if (stage === 'intro') {
      // Soft dismiss: hide for this session, but allow the panel to return on
      // next launch so a casually-dismissed first-run user isn't stranded.
      setSoftDismissed(true);
      return;
    }
    const next = await patchOnboardingState(io, { dismissed: true });
    setState(next);
  };

  const handleSeedPracticeTask = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      await window.api.onboarding.seedTask(projectPath);
      await useProjectStore.getState().loadTasks(projectPath);
      const next = await readOnboardingState(io);
      if (next) setState(next);
    } finally {
      setSeeding(false);
    }
  };

  const handleMoveBackToTodo = async () => {
    if (!seededTask) return;
    await useProjectStore.getState().moveTask(projectPath, seededTask.taskNumber, 'todo', 0);
  };

  const handleUseExampleHook = async () => {
    try {
      const result = await window.api.hooks.save(projectPath, {
        id: `hook-${Date.now()}`,
        type: 'start',
        name: 'Start Hook',
        command: EXAMPLE_START_HOOK_COMMAND,
      });
      if (!result.success) {
        useProjectStore.getState().addToast("Couldn't save the start hook", 'error');
        return;
      }
      await useProjectStore.getState().loadProjectConfig(projectPath);
      useProjectStore.getState().addToast('Start hook configured', 'success');
    } catch (error) {
      useProjectStore
        .getState()
        .addToast(error instanceof Error ? error.message : "Couldn't save the start hook", 'error');
    }
  };

  const renderStageBody = (s: Stage) => (
    <>
      {s === 'intro' && <IntroStage source={state.source} />}
      {s === 'setup' && <SetupStage configured={startHookConfigured} onUseExampleHook={handleUseExampleHook} />}
      {s === 'in-flight' && (
        <InFlightStage
          stuck={stuckLatched}
          startHookConfigured={startHookConfigured}
          onConfigureCliAgent={onConfigureCliAgent}
          onMoveBackToTodo={handleMoveBackToTodo}
        />
      )}
      {s === 'complete' && <CompleteStage />}
      <StageCtas
        stage={s}
        startHookConfigured={startHookConfigured}
        seeding={seeding}
        stuck={s === 'in-flight' && stuckLatched}
        onConfigureCliAgent={onConfigureCliAgent}
        onOpenHelp={onOpenHelp}
        onDismiss={handleDismiss}
        onSeedPracticeTask={handleSeedPracticeTask}
        onMoveBackToTodo={handleMoveBackToTodo}
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
        aria-label={stage === 'intro' ? 'Hide onboarding for now' : 'Dismiss onboarding'}
        title={stage === 'intro' ? 'Hide for now' : 'Dismiss'}
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
  stuck: boolean;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
  onDismiss: () => void;
  onSeedPracticeTask: () => void;
  onMoveBackToTodo: () => void;
}

function StageCtas({
  stage,
  startHookConfigured,
  seeding,
  stuck,
  onConfigureCliAgent,
  onOpenHelp,
  onDismiss,
  onSeedPracticeTask,
  onMoveBackToTodo,
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
      {stage === 'setup' && (
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
      {stage === 'in-flight' && stuck && !startHookConfigured && (
        <button
          className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out"
          onClick={onConfigureCliAgent}
        >
          <Icon name="terminal" className="w-3.5 h-3.5" />
          Configure start hook
        </button>
      )}
      {stage === 'in-flight' && stuck && (
        <button
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full active:scale-[0.98] transition-all duration-150 ease-out ${
            startHookConfigured
              ? 'text-white bg-accent hover:bg-accent-hover'
              : 'text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary'
          }`}
          onClick={onMoveBackToTodo}
        >
          <Icon name="arrow-left" className="w-3.5 h-3.5" />
          Move task back to To Do
        </button>
      )}
      <button
        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
        onClick={onOpenHelp}
      >
        <Icon name="question" className="w-3.5 h-3.5" />
        Help & setup
      </button>
      <button
        className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
        onClick={() => window.api.openExternal('https://ouijit.com/docs')}
      >
        <Icon name="file-text" className="w-3.5 h-3.5" />
        Docs
      </button>
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

function IntroStage({ source }: { source: FirstProjectSource | undefined }) {
  const leadVerb = source === 'created' ? 'Created' : 'Added';
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <StepBadge done={true} number={0} />
        <div className="text-xs text-text-primary">{leadVerb} your first project</div>
      </div>
      <ol className="flex flex-col gap-3">
        <li className="flex gap-3">
          <StepBadge done={false} number={1} />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary mb-1">Try a practice task</div>
            <div className="text-xs text-text-secondary leading-relaxed">
              A dry run that shows how hooks and the{' '}
              <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[11px]">ouijit</code> CLI work together.
            </div>
          </div>
        </li>
      </ol>
    </>
  );
}

function SetupStage({ configured, onUseExampleHook }: { configured: boolean; onUseExampleHook: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <StepBadge done={true} number={0} />
        <div className="text-xs text-text-primary">Practice task added to To Do</div>
      </div>
      <ol className="flex flex-col gap-3">
        <li className="flex gap-3">
          <StepBadge done={configured} number={1} />
          <div className={`min-w-0 ${configured ? 'opacity-50' : ''}`}>
            <div className="text-xs font-medium text-text-primary mb-1">Configure a start hook</div>
            <div className="text-xs text-text-secondary leading-relaxed mb-2">
              The command Ouijit runs when a task enters In Progress. For example:
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="inline-block font-mono text-[12px] text-text-primary bg-white/5 rounded-md px-2.5 py-1.5 max-w-full overflow-x-auto whitespace-nowrap">
                {EXAMPLE_START_HOOK_COMMAND}
              </code>
              {!configured && (
                <button
                  type="button"
                  onClick={onUseExampleHook}
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out"
                >
                  Use this
                </button>
              )}
            </div>
          </div>
        </li>
        <li
          className={`flex gap-3 transition-opacity duration-200 ease-out ${configured ? 'opacity-100' : 'opacity-50'}`}
        >
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

interface InFlightStageProps {
  stuck: boolean;
  startHookConfigured: boolean;
  onConfigureCliAgent: () => void;
  onMoveBackToTodo: () => void;
}

function InFlightStage({ stuck, startHookConfigured }: InFlightStageProps) {
  if (stuck) {
    return (
      <>
        <div className="flex items-center gap-2 mb-2">
          <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold bg-amber-500/20 text-amber-300">
            !
          </span>
          <div className="text-xs text-text-primary font-medium">
            {startHookConfigured ? 'Start hook didn’t fire' : 'No start hook configured'}
          </div>
        </div>
        <div className="text-xs text-text-secondary leading-relaxed">
          {startHookConfigured
            ? 'The hook was set after the task moved. Move it back to To Do and drag it forward again to run it.'
            : 'Dragging into In Progress fires the start hook. Set one up, then move the task back to To Do and forward again.'}
        </div>
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <StepBadge done={true} number={0} />
        <div className="text-xs text-text-primary">
          &ldquo;Your first task&rdquo; is in <span className="font-medium">In Progress</span>
        </div>
      </div>
      <div className="text-xs text-text-secondary leading-relaxed">
        The start hook is running in the task&rsquo;s terminal.
      </div>
    </>
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
