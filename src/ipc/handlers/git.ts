import { typedHandle } from '../helpers';
import {
  getGitStatus,
  getGitFileStatus,
  getGitDropdownInfo,
  checkoutBranch,
  createBranch,
  mergeIntoMain,
  getFileDiff,
  listDiffBases,
  fetchDiffBase,
} from '../../git';

export function registerGitHandlers(): void {
  typedHandle('get-git-status', (projectPath) => getGitStatus(projectPath));
  typedHandle('get-git-file-status', (projectPath, diffBase) => getGitFileStatus(projectPath, diffBase));
  typedHandle('get-git-dropdown-info', (projectPath) => getGitDropdownInfo(projectPath));
  typedHandle('git-diff-bases', (projectPath) => listDiffBases(projectPath));
  typedHandle('git-fetch-diff-base', (projectPath, ref) => fetchDiffBase(projectPath, ref));
  typedHandle('git-checkout', (projectPath, branchName) => checkoutBranch(projectPath, branchName));
  typedHandle('git-create-branch', (projectPath, branchName) => createBranch(projectPath, branchName));
  typedHandle('git-merge-into-main', (projectPath) => mergeIntoMain(projectPath));
  typedHandle('get-file-diff', (projectPath, filePath, contextLines, untracked) =>
    getFileDiff(projectPath, filePath, contextLines, untracked),
  );
}
