import { createTodoTask } from './worktree';
import { getGlobalSetting, getTaskByNumber, setGlobalSetting } from './db';
import { getLogger } from './logger';
import { type OnboardingStorageIO, patchOnboardingState, readOnboardingState } from './onboardingState';
import { getProjectList } from './scanner';
import type { FirstProjectSource } from './types';

const onboardingLog = getLogger().scope('onboarding');

export const ONBOARDING_TASK_NAME = 'Your first task';

export const ONBOARDING_TASK_PROMPT = `Welcome to Ouijit. This is a practice task to show how the app works end to end.

Create a file named \`hello.txt\` in the project root containing the text \`hello world\`, then move this task to In Review.

The \`ouijit\` CLI is available in this terminal; use \`ouijit --help\` if you need it.`;

const io: OnboardingStorageIO = {
  get: getGlobalSetting,
  set: setGlobalSetting,
};

/**
 * Records the first project (whether via create-new or open-existing).
 * Idempotent: subsequent project additions are ignored so the panel stays
 * anchored to the original first project. Returns whether this call was the
 * one that set the value.
 *
 * Existing users from before this release won't have any `onboarding:state`
 * yet, so without a guard the next project they add would re-trigger the
 * first-run flow. We detect them by checking the project list at call time:
 * if more than this one project is already registered, the user has used
 * Ouijit before and should be treated as already onboarded.
 */
export async function recordFirstProjectIfNeeded(projectPath: string, source: FirstProjectSource): Promise<boolean> {
  // Errors here must not bubble: this runs inside the create-project and
  // add-project IPC handlers, and we don't want a settings-read or scanner
  // failure to make a successful project add look like a failure to the
  // renderer. Worst case the user just doesn't get the onboarding panel.
  try {
    const existing = await readOnboardingState(io);
    if (existing?.firstProjectPath) return false;

    const projects = await getProjectList();
    if (projects.length > 1) {
      await patchOnboardingState(io, { dismissed: true });
      onboardingLog.info('existing user detected; suppressing onboarding', { projectCount: projects.length });
      return false;
    }

    await patchOnboardingState(io, { firstProjectPath: projectPath, source });
    onboardingLog.info('recorded first project', { projectPath, source });
    return true;
  } catch (error) {
    onboardingLog.error('recordFirstProjectIfNeeded failed', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Seeds the onboarding tutorial task in the user's first project. Idempotent
 * if a real seeded task already exists. If the persisted `seededTaskNumber`
 * points at a task that's been deleted, we treat the reference as stale and
 * re-seed — otherwise the user would be stranded on the intro stage with the
 * IPC silently no-op'ing forever. Failure is non-fatal; we log and return.
 */
export async function seedOnboardingTaskIfFirstProject(projectPath: string): Promise<void> {
  try {
    const state = await readOnboardingState(io);
    if (state?.seededTaskNumber != null) {
      const existing = await getTaskByNumber(projectPath, state.seededTaskNumber);
      if (existing) return;
      onboardingLog.info('seeded task missing; re-seeding', {
        projectPath,
        previousTaskNumber: state.seededTaskNumber,
      });
    }

    const result = await createTodoTask(projectPath, ONBOARDING_TASK_NAME, ONBOARDING_TASK_PROMPT);
    if (!result.success || !result.task) {
      onboardingLog.warn('seed task creation failed', { projectPath, error: result.error });
      return;
    }

    await patchOnboardingState(io, { seededTaskNumber: result.task.taskNumber });
    onboardingLog.info('seeded onboarding task', { projectPath, taskNumber: result.task.taskNumber });
  } catch (error) {
    onboardingLog.error('seed failed unexpectedly', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
