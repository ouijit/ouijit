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

/**
 * Why this review cannot be submitted as it stands, or null when it can.
 *
 * `unplaceable` counts comments whose lines are no longer in the diff. GitHub
 * takes the batch as one payload and rejects all of it over any one of them, so
 * a single stranded comment is the whole review's problem. Zero from the CLI
 * path, which anchors by line at the moment it writes.
 */
export function reviewSubmitProblem(
  event: ReviewEvent,
  body: string,
  inlineComments: number,
  unplaceable = 0,
): string | null {
  if (event === 'COMMENT' && inlineComments === 0 && !body.trim()) {
    return 'Nothing to submit — add a comment or a review body first.';
  }
  if (unplaceable > 0) {
    return `${unplaceable} ${unplaceable === 1 ? 'comment is' : 'comments are'} on code no longer in the diff. GitHub would reject the whole review — discard or rewrite ${unplaceable === 1 ? 'it' : 'them'} first.`;
  }
  // GitHub rejects a COMMENT or REQUEST_CHANGES review with a blank body, even
  // when it carries inline comments — "Body can not be blank", 422, and the
  // whole batch is lost. Only an approval may be wordless.
  if (event !== 'APPROVE' && !body.trim()) {
    return 'GitHub needs a summary on this kind of review. Write one, or approve instead.';
  }
  return null;
}
