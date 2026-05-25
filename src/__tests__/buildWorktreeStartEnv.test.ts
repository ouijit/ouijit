import { describe, test, expect } from 'vitest';

import { buildWorktreeStartEnv } from '../components/terminal/terminalActions';
import type { TaskWithWorkspace, WorktreeInfo } from '../types';

const PROJECT = '/path/to/project';

function makeWorktree(patch: Partial<WorktreeInfo & { prompt?: string }> = {}): WorktreeInfo & { prompt?: string } {
  return {
    path: '/path/to/project/worktrees/T-1',
    branch: 'feat-1234567890',
    ...patch,
  } as WorktreeInfo & { prompt?: string };
}

function makeTask(patch: Partial<TaskWithWorkspace> = {}): TaskWithWorkspace {
  return {
    taskNumber: 1,
    name: 'Add Hello World to footer of README',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

describe('buildWorktreeStartEnv', () => {
  test('always sets the base worktree env vars', () => {
    const env = buildWorktreeStartEnv({
      hookType: 'continue',
      projectPath: PROJECT,
      worktreeInfo: makeWorktree(),
      label: 'My Task',
      task: makeTask(),
    });

    expect(env.OUIJIT_HOOK_TYPE).toBe('continue');
    expect(env.OUIJIT_PROJECT_PATH).toBe(PROJECT);
    expect(env.OUIJIT_WORKTREE_PATH).toBe('/path/to/project/worktrees/T-1');
    expect(env.OUIJIT_TASK_BRANCH).toBe('feat-1234567890');
    expect(env.OUIJIT_TASK_NAME).toBe('My Task');
  });

  // The bug (T-387): editing a task's description after its worktree exists
  // left OUIJIT_TASK_PROMPT stale, because the prompt was sourced from the
  // worktree snapshot captured at creation time. The prompt must come from the
  // live task instead.
  test('sources the prompt from the live task, not the stale worktree snapshot', () => {
    const env = buildWorktreeStartEnv({
      hookType: 'continue',
      projectPath: PROJECT,
      // Stale snapshot prompt from worktree-creation time.
      worktreeInfo: makeWorktree({ prompt: 'original description' }),
      label: 'My Task',
      // Description edited live after the worktree was created.
      task: makeTask({ prompt: 'edited description' }),
    });

    expect(env.OUIJIT_TASK_PROMPT).toBe('edited description');
  });

  test('exposes OUIJIT_TASK_DESCRIPTION as an alias of OUIJIT_TASK_PROMPT', () => {
    const env = buildWorktreeStartEnv({
      hookType: 'continue',
      projectPath: PROJECT,
      worktreeInfo: makeWorktree(),
      label: 'My Task',
      task: makeTask({ prompt: 'a description' }),
    });

    expect(env.OUIJIT_TASK_DESCRIPTION).toBe('a description');
    expect(env.OUIJIT_TASK_DESCRIPTION).toBe(env.OUIJIT_TASK_PROMPT);
  });

  test('omits the prompt vars entirely when the live task has no description', () => {
    const env = buildWorktreeStartEnv({
      hookType: 'continue',
      projectPath: PROJECT,
      worktreeInfo: makeWorktree(),
      label: 'My Task',
      task: makeTask({ prompt: undefined }),
    });

    expect('OUIJIT_TASK_PROMPT' in env).toBe(false);
    expect('OUIJIT_TASK_DESCRIPTION' in env).toBe(false);
  });
});
