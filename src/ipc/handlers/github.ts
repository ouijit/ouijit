import { getViewedFiles, setFileViewed } from '../../github/viewedFiles';
import { typedHandle } from '../helpers';
import {
  getAvailability,
  getInbox,
  getPullRequest,
  getPullRequestFreshness,
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
  typedHandle('github:pull-request-freshness', (projectPath, number) => getPullRequestFreshness(projectPath, number));
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

  typedHandle('github:drafts', (projectPath, prNumber, head) => listDrafts(projectPath, prNumber, head));
  typedHandle('github:save-draft', (projectPath, input) => saveDraft(projectPath, input));
  typedHandle('github:discard-draft', (_projectPath, draftId) => discardDraft(draftId));
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
  typedHandle('github:viewed-files', (projectPath, prNumber, headSha) =>
    getViewedFiles(projectPath, prNumber, headSha),
  );
  typedHandle('github:set-file-viewed', (projectPath, prNumber, headSha, path, viewed) =>
    setFileViewed(projectPath, prNumber, headSha, path, viewed),
  );
  typedHandle('github:merge-pr', (projectPath, prNumber, options) => mergePr(projectPath, prNumber, options));
  typedHandle('github:task-from-issue', (projectPath, issueNumber) => createTaskFromIssue(projectPath, issueNumber));
  typedHandle('github:task-from-pr', (projectPath, prNumber) => prepareTaskFromPullRequest(projectPath, prNumber));
}
