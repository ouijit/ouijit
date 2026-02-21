import * as path from 'node:path';
import { typedHandle } from '../helpers';
import {
  validateBranchName,
  generateBranchName,
  removeTaskWorktree,
  listWorktrees,
  shipWorktree,
} from '../../worktree';
import { getNextTaskNumber } from '../../taskMetadata';
import {
  getWorktreeDiff,
  getWorktreeFileDiff,
  mergeWorktreeBranch,
  listBranches,
  getMainBranch,
} from '../../git';

export function registerWorktreeHandlers(): void {
  typedHandle('worktree:validate-branch-name', (projectPath, branchName) =>
    validateBranchName(projectPath, branchName),
  );

  typedHandle('worktree:generate-branch-name', async (projectPath, name) => {
    const taskNumber = await getNextTaskNumber(projectPath);
    return generateBranchName(name, taskNumber);
  });

  typedHandle('worktree:remove', (projectPath, worktreePath) => {
    const dirName = path.basename(worktreePath);
    const taskNumber = parseInt(dirName.slice(2), 10);
    if (isNaN(taskNumber)) {
      return { success: false, error: 'Invalid worktree path: cannot extract task number' };
    }
    return removeTaskWorktree(projectPath, worktreePath, taskNumber);
  });

  typedHandle('worktree:list', (projectPath) => listWorktrees(projectPath));

  typedHandle('worktree:get-diff', (projectPath, worktreeBranch, targetBranch) =>
    getWorktreeDiff(projectPath, worktreeBranch, targetBranch),
  );

  typedHandle('worktree:get-file-diff', (projectPath, worktreeBranch, filePath, targetBranch) =>
    getWorktreeFileDiff(projectPath, worktreeBranch, filePath, targetBranch),
  );

  typedHandle('worktree:merge', (projectPath, worktreeBranch) =>
    mergeWorktreeBranch(projectPath, worktreeBranch),
  );

  typedHandle('worktree:ship', (projectPath, worktreeBranch, commitMessage) =>
    shipWorktree(projectPath, worktreeBranch, commitMessage),
  );

  typedHandle('worktree:list-branches', (projectPath) => listBranches(projectPath));
  typedHandle('worktree:get-main-branch', (projectPath) => getMainBranch(projectPath));
}
