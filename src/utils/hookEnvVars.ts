import type { TaskWithWorkspace } from '../types';
import { descriptionToHookPrompt } from './descriptionAttachments';

/** Variables Ouijit sets in a hook's shell, and fills into a task chat's first message. */
export const HOOK_ENV_VARS = [
  'OUIJIT_PROJECT_PATH',
  'OUIJIT_WORKTREE_PATH',
  'OUIJIT_TASK_BRANCH',
  'OUIJIT_TASK_NUMBER',
  'OUIJIT_TASK_NAME',
  'OUIJIT_TASK_DESCRIPTION',
] as const;

const KNOWN = new Set<string>([...HOOK_ENV_VARS, 'OUIJIT_TASK_PROMPT']);

/**
 * The task's values for those variables. The description has to be the task's
 * current one, read from the database, not one captured when its worktree was made.
 */
export function taskHookVars(params: {
  projectPath: string;
  worktree: { path: string; branch: string };
  name: string;
  task: TaskWithWorkspace | null;
}): Record<string, string> {
  const { projectPath, worktree, name, task } = params;
  const values: Record<string, string> = {
    OUIJIT_PROJECT_PATH: projectPath,
    OUIJIT_WORKTREE_PATH: worktree.path,
    OUIJIT_TASK_BRANCH: worktree.branch,
    OUIJIT_TASK_NAME: name,
    ...(task && { OUIJIT_TASK_NUMBER: String(task.taskNumber) }),
  };
  if (task?.prompt) {
    const description = descriptionToHookPrompt(task.prompt);
    values.OUIJIT_TASK_DESCRIPTION = description;
    // The variable's old name, which hooks written before it was renamed still use.
    values.OUIJIT_TASK_PROMPT = description;
  }
  return values;
}

/**
 * `text` with each of Ouijit's variables, written `$NAME` or `${NAME}`, replaced
 * by its value, or by nothing where it has none. Nothing else is expanded: no
 * shell reads this text.
 */
export function fillHookVars(text: string, values: Record<string, string>): string {
  return text.replace(/\$(?:\{([A-Z_]+)\}|([A-Z_]+))/g, (match, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? '';
    return KNOWN.has(name) ? (values[name] ?? '') : match;
  });
}
