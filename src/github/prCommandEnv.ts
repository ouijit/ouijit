/**
 * The environment a pull request command runs with.
 *
 * Defined once so the terminal spawn and anything added later cannot drift into
 * offering different names for the same facts. These are frozen API the moment
 * anyone writes a command against them.
 */

import type { PullRequestDetail } from './types';

export function prCommandEnv(detail: PullRequestDetail, worktreePath?: string): Record<string, string> {
  return {
    OUIJIT_PR_NUMBER: String(detail.number),
    OUIJIT_PR_BRANCH: detail.headRefName,
    OUIJIT_PR_URL: detail.url,
    OUIJIT_PR_TITLE: detail.title,
    ...(worktreePath ? { OUIJIT_WORKTREE_PATH: worktreePath } : {}),
  };
}
