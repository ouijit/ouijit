/**
 * Background refresh for the PR inbox.
 *
 * Webhooks are not an option here: they need a publicly reachable HTTPS
 * endpoint, which is the opposite of the local-first posture this app has.
 * Conditional polling is the supported path, so that is what this does.
 *
 * The interval is deliberately conservative. We inherit the user's own `gh`
 * rate limit — 5,000 REST requests/hour shared with every other tool using that
 * token — so the fast paths are manual refresh and refresh-on-focus, not a
 * tighter timer. Polling pauses entirely while the window is hidden, the same
 * way the periodic git-status refresher does.
 */

import type { BrowserWindow } from 'electron';
import { typedPush } from '../ipc/helpers';
import { getLogger } from '../logger';
import { getProjectList } from '../projectList';
import { isGithubEnabled, getInbox } from './service';
import type { PullRequestSummary } from './types';

const pollLog = getLogger().scope('github:poll');

const POLL_INTERVAL_MS = 5 * 60 * 1000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let windowRef: BrowserWindow | null = null;
let polling = false;

/**
 * Last seen state per project, as a cheap fingerprint. A push only goes out
 * when something actually changed, so a quiet repo costs one `gh` call every
 * five minutes and zero renderer work.
 */
const lastFingerprint = new Map<string, string>();

function fingerprint(prs: PullRequestSummary[]): string {
  return prs
    .map((pr) => `${pr.number}:${pr.updatedAt}:${pr.reviewDecision ?? ''}:${pr.checksState}:${pr.state}`)
    .sort()
    .join('|');
}

async function pollOnce(): Promise<void> {
  if (polling || !windowRef || windowRef.isDestroyed()) return;
  // The window being hidden is the signal to stop spending rate limit on a
  // project nobody is looking at.
  if (!windowRef.isVisible()) return;

  polling = true;
  try {
    const projects = await getProjectList();
    for (const project of projects) {
      if (!(await isGithubEnabled(project.path))) continue;
      try {
        const inbox = await getInbox(project.path);
        const next = fingerprint([...inbox.needsReview, ...inbox.mine, ...inbox.others]);
        if (lastFingerprint.get(project.path) === next) continue;
        lastFingerprint.set(project.path, next);
        if (windowRef && !windowRef.isDestroyed()) {
          typedPush(windowRef, 'github:changed', { projectPath: project.path, ts: Date.now() });
        }
      } catch (error) {
        // A single unreachable repo (renamed, permissions revoked, offline)
        // must not stop the other projects from refreshing.
        pollLog.warn('poll failed for project', {
          project: project.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    polling = false;
  }
}

export function initGithubPoller(mainWindow: BrowserWindow): void {
  windowRef = mainWindow;
  if (intervalId) return;
  intervalId = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  pollLog.info('github poller initialized', { intervalMs: POLL_INTERVAL_MS });
}

export function cleanupGithubPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  windowRef = null;
  lastFingerprint.clear();
}

/**
 * Force a refresh now, bypassing the fingerprint check. This is the
 * refresh-on-focus and manual-refresh path: the renderer has just asked for
 * fresh data, so a push goes out whether or not anything moved.
 */
export async function refreshGithubNow(projectPath: string): Promise<void> {
  lastFingerprint.delete(projectPath);
  if (windowRef && !windowRef.isDestroyed()) {
    typedPush(windowRef, 'github:changed', { projectPath, ts: Date.now() });
  }
}

export function _resetPollerForTesting(): void {
  cleanupGithubPoller();
  polling = false;
}
