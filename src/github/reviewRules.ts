/**
 * What GitHub will refuse, worked out before it is asked.
 *
 * A review reaches GitHub from two directions — the panel's Review menu, and
 * the CLI/REST path an agent uses — so the rule cannot live in the component
 * that happens to have a button. Stated once here: the panel disables the entry
 * and shows this as the reason, and main returns it as the error.
 *
 * Leaf module, one type-only import, so the renderer can have it too.
 */

import type { ReviewEvent } from './types';

/** Why this review cannot be submitted as it stands, or null when it can. */
export function reviewSubmitProblem(event: ReviewEvent, body: string, inlineComments: number): string | null {
  if (event === 'COMMENT' && inlineComments === 0 && !body.trim()) {
    return 'Nothing to submit — add a comment or a review body first.';
  }
  // GitHub rejects a COMMENT or REQUEST_CHANGES review with a blank body, even
  // when it carries inline comments — "Body can not be blank", 422, and the
  // whole batch is lost. Only an approval may be wordless.
  if (event !== 'APPROVE' && !body.trim()) {
    return 'GitHub needs a summary on this kind of review. Write one, or approve instead.';
  }
  return null;
}
