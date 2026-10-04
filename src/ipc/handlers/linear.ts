import { typedHandle } from '../helpers';
import {
  comment,
  createTaskFromIssue,
  discardDraft,
  getAvailability,
  getConnection,
  getIssue,
  getIssues,
  linkTaskToIssue,
  listDrafts,
  moveIssue,
  sendDraft,
  setCredential,
  setScope,
} from '../../linear/service';

/**
 * The gating — experimental flag, credential, scope — lives in the service, so
 * the REST router gets the same guarantees from the same code. Nothing here
 * reads or returns the API key.
 */
export function registerLinearHandlers(): void {
  typedHandle('linear:connection', (projectPath, recheck) => getConnection(projectPath, recheck));
  typedHandle('linear:set-credential', (apiKey, projectPath) => setCredential(apiKey, projectPath));
  typedHandle('linear:availability', (projectPath, recheck) => getAvailability(projectPath, recheck));
  typedHandle('linear:set-scope', (projectPath, scope) => setScope(projectPath, scope));

  typedHandle('linear:issues', (projectPath) => getIssues(projectPath));
  typedHandle('linear:issue', (projectPath, id) => getIssue(projectPath, id));

  typedHandle('linear:comment', (projectPath, issueId, body) => comment(projectPath, issueId, body));
  typedHandle('linear:move-issue', (projectPath, issueId, stateId) => moveIssue(projectPath, issueId, stateId));

  typedHandle('linear:drafts', (projectPath, issueId) => listDrafts(projectPath, issueId));
  typedHandle('linear:discard-draft', (projectPath, draftId) => discardDraft(projectPath, draftId));
  typedHandle('linear:send-draft', (projectPath, draftId) => sendDraft(projectPath, draftId));

  typedHandle('linear:link-task', (projectPath, taskNumber, identifier) =>
    linkTaskToIssue(projectPath, taskNumber, identifier),
  );
  typedHandle('linear:task-from-issue', (projectPath, identifier) => createTaskFromIssue(projectPath, identifier));
}
