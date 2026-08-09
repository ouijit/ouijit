import { typedHandle } from '../helpers';
import {
  getAvailability,
  getInbox,
  getPullRequest,
  getPullRequestFiles,
  getPullRequestFileDiff,
  getPullRequestFileVersions,
  getIssues,
  getIssue,
  linkTaskToPr,
  linkTaskToIssue,
  detectPullRequestForTask,
  listDrafts,
  saveDraft,
  discardDraft,
  submitPullRequestReview,
  commentOnPullRequest,
  replyToThread,
  deleteComment,
  resolveThread,
  createPullRequestForTask,
  mergePr,
  listPrCommands,
  savePrCommand,
  deletePrCommand,
  getLens,
  clearLens,
  listLenses,
  saveLens,
  deleteLens,
  createTaskFromIssue,
  prepareTaskFromPullRequest,
} from '../../github/service';

/**
 * Thin delegations, matching every other handler module in here. All the
 * gating (experimental flag, `gh` presence, auth, remote) lives in the service
 * so the REST router gets the same guarantees without duplicating them.
 */
export function registerGithubHandlers(): void {
  typedHandle('github:availability', (projectPath, recheck) => getAvailability(projectPath, recheck));
  typedHandle('github:inbox', (projectPath) => getInbox(projectPath));
  typedHandle('github:pull-request', (projectPath, number) => getPullRequest(projectPath, number));
  typedHandle('github:pull-request-files', (projectPath, number, baseSha, headSha) =>
    getPullRequestFiles(projectPath, number, baseSha, headSha),
  );
  typedHandle(
    'github:pull-request-file-diff',
    (projectPath, number, baseSha, headSha, filePath, contextLines, oldPath) =>
      getPullRequestFileDiff(projectPath, number, baseSha, headSha, filePath, contextLines, oldPath),
  );
  typedHandle('github:pull-request-file-versions', (projectPath, number, baseSha, headSha, filePath, oldPath) =>
    getPullRequestFileVersions(projectPath, number, baseSha, headSha, filePath, oldPath),
  );
  typedHandle('github:issues', (projectPath) => getIssues(projectPath));
  typedHandle('github:issue', (projectPath, number) => getIssue(projectPath, number));

  typedHandle('github:link-task-pr', (projectPath, taskNumber, prNumber) =>
    linkTaskToPr(projectPath, taskNumber, prNumber),
  );
  typedHandle('github:link-task-issue', (projectPath, taskNumber, issueNumber) =>
    linkTaskToIssue(projectPath, taskNumber, issueNumber),
  );
  typedHandle('github:detect-task-pr', (projectPath, taskNumber) => detectPullRequestForTask(projectPath, taskNumber));

  typedHandle('github:drafts', (projectPath, prNumber) => listDrafts(projectPath, prNumber));
  typedHandle('github:save-draft', (projectPath, input) => saveDraft(projectPath, input));
  typedHandle('github:discard-draft', (projectPath, draftId) => discardDraft(projectPath, draftId));
  typedHandle('github:submit-review', (projectPath, prNumber, event, body) =>
    submitPullRequestReview(projectPath, prNumber, event, body),
  );
  typedHandle('github:comment', (projectPath, prNumber, body) => commentOnPullRequest(projectPath, prNumber, body));
  typedHandle('github:reply-to-thread', (projectPath, prNumber, commentId, body) =>
    replyToThread(projectPath, prNumber, commentId, body),
  );
  typedHandle('github:delete-comment', (projectPath, kind, commentId) => deleteComment(projectPath, kind, commentId));
  typedHandle('github:resolve-thread', (projectPath, threadId, resolved) =>
    resolveThread(projectPath, threadId, resolved),
  );
  typedHandle('github:create-pr', (projectPath, taskNumber, options) =>
    createPullRequestForTask(projectPath, taskNumber, options),
  );
  typedHandle('github:list-pr-commands', (projectPath) => listPrCommands(projectPath));
  typedHandle('github:save-pr-command', (projectPath, name, command, previousName) =>
    savePrCommand(projectPath, name, command, previousName),
  );
  typedHandle('github:delete-pr-command', (projectPath, name) => deletePrCommand(projectPath, name));
  typedHandle('github:lens', (projectPath, prNumber, headSha) => getLens(projectPath, prNumber, headSha));
  typedHandle('github:list-lenses', (projectPath) => listLenses(projectPath));
  typedHandle('github:save-lens', (projectPath, name, command, previousName) =>
    saveLens(projectPath, name, command, previousName),
  );
  typedHandle('github:delete-lens', (projectPath, name) => deleteLens(projectPath, name));
  typedHandle('github:clear-lens', (projectPath, prNumber) => clearLens(projectPath, prNumber));

  typedHandle('github:merge-pr', (projectPath, prNumber, method, deleteBranch) =>
    mergePr(projectPath, prNumber, method, deleteBranch),
  );
  typedHandle('github:task-from-issue', (projectPath, issueNumber) => createTaskFromIssue(projectPath, issueNumber));
  typedHandle('github:task-from-pr', (projectPath, prNumber) => prepareTaskFromPullRequest(projectPath, prNumber));
}
