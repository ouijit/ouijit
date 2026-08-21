/**
 * What GitHub will refuse, worked out before it is asked. A review reaches
 * GitHub from the panel's Review menu and from the CLI/REST path, so both read
 * this: the panel as the disabled reason, main as the error.
 *
 * Leaf module with one type-only import, so the renderer can import it.
 */

import type { ReviewEvent } from './types';

/**
 * Why this review cannot be submitted as it stands, or null when it can.
 *
 * `unplaceable` counts comments whose lines are no longer in the diff. GitHub
 * takes the batch as one payload and rejects all of it over any one of them.
 * Always zero from the CLI path, which anchors at the moment it writes.
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
