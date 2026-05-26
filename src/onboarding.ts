import { createTodoTask } from './worktree';
import { getGlobalSetting, setGlobalSetting } from './db';
import { getLogger } from './logger';

const onboardingLog = getLogger().scope('onboarding');

export const ONBOARDING_SEEDED_PROJECT_KEY = 'onboarding:seededProject';
export const ONBOARDING_DISMISSED_KEY = 'onboarding:dismissed';
export const ONBOARDING_TASK_NAME = 'Your first task: meet the Ouijit CLI';

export const ONBOARDING_TASK_PROMPT = `This is a guided practice task. Complete it by using the \`ouijit\` CLI, which is how Ouijit's board, terminals, and your agent stay in sync.

Steps:
1. Run \`ouijit task current\` to see this task. The CLI is pre-configured in this terminal (OUIJIT_API_URL and OUIJIT_PTY_ID are set automatically).
2. Create a file named \`hello.txt\` in the project root containing the text \`hello world\`.
3. Run \`ouijit task set-status <taskNumber> in_review\` using the number from step 1. Watch the card move across the board in real time.
4. Run \`ouijit task list\` to see the full board state.

When you're done, summarize what each command did so the user understands how to drive Ouijit from the CLI.`;

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
    onboardingLog.info('seeded onboarding task', { projectPath, taskNumber: result.task?.taskNumber });
  } catch (error) {
    onboardingLog.error('seed failed unexpectedly', {
      projectPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
