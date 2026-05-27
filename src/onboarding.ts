import { createTodoTask } from './worktree';
import { getGlobalSetting, setGlobalSetting } from './db';
import { getLogger } from './logger';

const onboardingLog = getLogger().scope('onboarding');

export const ONBOARDING_FIRST_PROJECT_KEY = 'onboarding:firstProjectPath';
export const ONBOARDING_SEEDED_PROJECT_KEY = 'onboarding:seededProject';
export const ONBOARDING_SEEDED_TASK_NUMBER_KEY = 'onboarding:seededTaskNumber';
export const ONBOARDING_SEEDED_ON_DEMAND_KEY = 'onboarding:seededOnDemand';
export const ONBOARDING_DISMISSED_KEY = 'onboarding:dismissed';
export const ONBOARDING_TASK_NAME = 'Your first task';

/**
 * Records the path of the first project the user adds (whether via create-new
 * or open-existing). The OnboardingPanel uses this to decide which project
 * gets the first-run experience. Idempotent: subsequent project additions are
 * ignored, so the panel remains anchored to the original first project.
 *
 * Returns whether this call was the one that set the value — callers use this
 * to decide whether to trigger one-time side effects like auto-seeding.
 */
export async function recordFirstProjectIfNeeded(projectPath: string): Promise<boolean> {
  const existing = await getGlobalSetting(ONBOARDING_FIRST_PROJECT_KEY);
  if (existing) return false;
  await setGlobalSetting(ONBOARDING_FIRST_PROJECT_KEY, projectPath);
  onboardingLog.info('recorded first project', { projectPath });
  return true;
}

export const ONBOARDING_TASK_PROMPT = `Welcome to Ouijit. This is a practice task to show how the app works end to end.

Create a file named \`hello.txt\` in the project root containing the text \`hello world\`, then move this task to In Review.

The \`ouijit\` CLI is available in this terminal; use \`ouijit --help\` if you need it.`;

/**
 * Seeds the onboarding tutorial task on the first project the user ever creates.
 * Subsequent project creations are no-ops. Failure to seed is non-fatal; we
 * log and let project creation succeed, since onboarding is a nice-to-have,
 * not a blocker.
 */
export async function seedOnboardingTaskIfFirstProject(projectPath: string): Promise<void> {
  try {
    const already = await getGlobalSetting(ONBOARDING_SEEDED_PROJECT_KEY);
    if (already) return;

    const result = await createTodoTask(projectPath, ONBOARDING_TASK_NAME, ONBOARDING_TASK_PROMPT);
    if (!result.success) {
      onboardingLog.warn('seed task creation failed', { projectPath, error: result.error });
      return;
    }

    await setGlobalSetting(ONBOARDING_SEEDED_PROJECT_KEY, projectPath);
    if (result.task) {
      await setGlobalSetting(ONBOARDING_SEEDED_TASK_NUMBER_KEY, String(result.task.taskNumber));
    }
    onboardingLog.info('seeded onboarding task', { projectPath, taskNumber: result.task?.taskNumber });
  } catch (error) {
    onboardingLog.error('seed failed unexpectedly', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
