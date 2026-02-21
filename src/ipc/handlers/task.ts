import { typedHandle } from '../helpers';
import { createTaskWorktree, createTodoTask, startTask, checkTaskWorktree, recoverTaskWorktree } from '../../worktree';
import {
  setTaskMergeTarget,
  setTaskSandboxed,
  setTaskName,
  setTaskDescription,
} from '../../db';
import {
  setTaskStatusWithHooks,
  reorderTaskWithHooks,
  deleteTaskWithWorktree,
  getTasksWithWorkspaces,
  getTaskWithWorkspace,
} from '../../taskLifecycle';

export function registerTaskHandlers(): void {
  typedHandle('task:create', (projectPath, name, prompt) =>
    createTodoTask(projectPath, name, prompt),
  );

  typedHandle('task:create-and-start', (projectPath, name, prompt, branchName) =>
    createTaskWorktree(projectPath, name, prompt, branchName),
  );

  typedHandle('task:start', (projectPath, taskNumber, branchName) =>
    startTask(projectPath, taskNumber, branchName),
  );

  typedHandle('task:get-all', (projectPath) => getTasksWithWorkspaces(projectPath));
  typedHandle('task:get-by-number', (projectPath, taskNumber) => getTaskWithWorkspace(projectPath, taskNumber));

  typedHandle('task:set-status', (projectPath, taskNumber, status) =>
    setTaskStatusWithHooks(projectPath, taskNumber, status),
  );

  typedHandle('task:delete', (projectPath, taskNumber) =>
    deleteTaskWithWorktree(projectPath, taskNumber),
  );

  typedHandle('task:set-merge-target', (projectPath, taskNumber, mergeTarget) =>
    setTaskMergeTarget(projectPath, taskNumber, mergeTarget),
  );

  typedHandle('task:set-sandboxed', (projectPath, taskNumber, sandboxed) =>
    setTaskSandboxed(projectPath, taskNumber, sandboxed),
  );

  typedHandle('task:set-name', (projectPath, taskNumber, name) =>
    setTaskName(projectPath, taskNumber, name),
  );

  typedHandle('task:set-description', (projectPath, taskNumber, description) =>
    setTaskDescription(projectPath, taskNumber, description),
  );

  typedHandle('task:reorder', (projectPath, taskNumber, newStatus, targetIndex) =>
    reorderTaskWithHooks(projectPath, taskNumber, newStatus, targetIndex),
  );

  typedHandle('task:check-worktree', (projectPath, taskNumber) =>
    checkTaskWorktree(projectPath, taskNumber),
  );

  typedHandle('task:recover', (projectPath, taskNumber) =>
    recoverTaskWorktree(projectPath, taskNumber),
  );
}
