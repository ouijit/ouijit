import { typedHandle } from '../helpers';
import {
  getGitStatus,
  getCompactGitStatus,
  getGitDropdownInfo,
  checkoutBranch,
  createBranch,
  mergeIntoMain,
  getChangedFiles,
  getFileDiff,
} from '../../git';

export function registerGitHandlers(): void {
  typedHandle('get-git-status', (projectPath) => getGitStatus(projectPath));
  typedHandle('get-compact-git-status', (projectPath) => getCompactGitStatus(projectPath));
  typedHandle('get-git-dropdown-info', (projectPath) => getGitDropdownInfo(projectPath));
  typedHandle('git-checkout', (projectPath, branchName) => checkoutBranch(projectPath, branchName));
  typedHandle('git-create-branch', (projectPath, branchName) => createBranch(projectPath, branchName));
  typedHandle('git-merge-into-main', (projectPath) => mergeIntoMain(projectPath));
  typedHandle('get-changed-files', (projectPath) => getChangedFiles(projectPath));
  typedHandle('get-file-diff', (projectPath, filePath) => getFileDiff(projectPath, filePath));
}
