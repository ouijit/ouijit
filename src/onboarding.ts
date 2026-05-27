import { createTodoTask } from './worktree';
import { getGlobalSetting, setGlobalSetting } from './db';
import { getLogger } from './logger';
import { type OnboardingStorageIO, patchOnboardingState, readOnboardingState } from './onboardingState';
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
 */
export async function recordFirstProjectIfNeeded(projectPath: string, source: FirstProjectSource): Promise<boolean> {
  const existing = await readOnboardingState(io);
  if (existing?.firstProjectPath) return false;
  await patchOnboardingState(io, { firstProjectPath: projectPath, source });
  onboardingLog.info('recorded first project', { projectPath, source });
  return true;
}

/**
 * Seeds the onboarding tutorial task in the user's first project. Idempotent
 * via the `seededTaskNumber` field — if a task has already been seeded, this
 * is a no-op. Failure is non-fatal; we log and return.
 */
export async function seedOnboardingTaskIfFirstProject(projectPath: string): Promise<void> {
  try {
    const state = await readOnboardingState(io);
    if (state?.seededTaskNumber != null) return;

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
