/**
 * Resolve the session a session-scoped CLI command acts on: an explicit
 * argument, or OUIJIT_SESSION_ID, which the app sets in every session it
 * starts. Exits with a JSON error when neither is set.
 */

import { printError } from './output';

export function resolveSessionId(explicit?: string): string {
  const sessionId = explicit || process.env['OUIJIT_SESSION_ID'];
  if (!sessionId) {
    return printError(
      'No session-id provided and OUIJIT_SESSION_ID not set. Provide <session-id> or run from an Ouijit session.',
    );
  }
  return sessionId;
}
