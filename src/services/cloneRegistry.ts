/**
 * The clones currently in flight, held in memory rather than in the projects
 * table. A crash therefore leaves only a staging directory, which the next
 * clone removes.
 *
 * Keyed by the path the project will occupy, which is unique because a clone
 * refuses to start when something already sits there.
 */

import * as path from 'node:path';
import { resolveCloneTarget, runClone, type RunningClone } from '../repoCloner';
import { registerProducedProject } from './projectRegistration';
import { getLogger } from '../logger';
import type { CloneJob, CloneProgress, CloneProjectOptions, StartCloneResult } from '../types';

const registryLog = getLogger().scope('cloneRegistry');

interface Entry {
  job: CloneJob;
  running?: RunningClone;
}

const entries = new Map<string, Entry>();

let notify: (jobs: CloneJob[]) => void = () => {};
let announceLanded: (projectPath: string) => void = () => {};

export function setCloneListeners(listeners: {
  onChanged: (jobs: CloneJob[]) => void;
  onLanded: (projectPath: string) => void;
}): void {
  notify = listeners.onChanged;
  announceLanded = listeners.onLanded;
}

export function listCloneJobs(): CloneJob[] {
  return [...entries.values()].map((entry) => entry.job);
}

function publish(): void {
  notify(listCloneJobs());
}

/** False once a retry has replaced this entry: a superseded run must not write to the list. */
function isCurrent(entry: Entry): boolean {
  return entries.get(entry.job.projectPath) === entry;
}

function reportProgress(entry: Entry, progress: CloneProgress): void {
  if (!isCurrent(entry)) return;
  // git redraws the same percentage repeatedly; each publish re-renders the
  // sidebar, so a line carrying nothing new must not become one.
  const { phase, percent, detail } = entry.job;
  if (progress.phase === phase && progress.percent === percent && progress.detail === detail) return;
  entry.job = { ...entry.job, ...progress };
  publish();
}

function fail(entry: Entry, error: string, output?: string): void {
  if (!isCurrent(entry)) return;
  entry.job = { ...entry.job, status: 'failed', error, output };
  publish();
}

function forget(entry: Entry): void {
  if (!isCurrent(entry)) return;
  entries.delete(entry.job.projectPath);
  publish();
}

/**
 * `replacing` names the path a retry is taking over, which keeps its place in
 * the list until this one is ready: a path that is briefly neither a clone nor
 * a project puts the project view on a directory that is not there.
 */
export async function startClone(options: CloneProjectOptions, replacing?: string): Promise<StartCloneResult> {
  const resolved = await resolveCloneTarget(options);
  if (resolved.ok === false) return { success: false, error: resolved.error };

  const { target } = resolved;
  if (entries.has(target.projectPath) && target.projectPath !== replacing) {
    return { success: false, error: `${path.basename(target.projectPath)} is already being cloned` };
  }

  const entry: Entry = {
    job: {
      projectPath: target.projectPath,
      name: target.identity.repo,
      identity: target.identity,
      status: 'cloning',
      phase: 'Connecting',
      percent: null,
      detail: null,
      startedAt: Date.now(),
    },
  };
  entries.set(target.projectPath, entry);
  publish();

  entry.running = runClone(target, (progress) => reportProgress(entry, progress));

  void entry.running.done.then(async (outcome) => {
    if (outcome.status === 'canceled') {
      forget(entry);
      return;
    }
    if (outcome.status === 'failed') {
      fail(entry, outcome.error, entry.running?.output());
      return;
    }

    const registered = await registerProducedProject(target.projectPath, 'cloned');
    if (registered.success === false) {
      fail(entry, registered.error);
      return;
    }

    if (!isCurrent(entry)) return;
    // Announced before the entry goes, so the renderer never sees a path with
    // neither a clone standing in for it nor a project row yet.
    announceLanded(target.projectPath);
    forget(entry);
  });

  return { success: true, projectPath: target.projectPath };
}

export function cancelClone(projectPath: string): void {
  const entry = entries.get(projectPath);
  if (!entry) return;
  registryLog.info('clone canceled', { projectPath });
  entry.running?.cancel();
  // A clone that already failed has no process left to signal, so nothing
  // would remove its entry.
  if (entry.job.status === 'failed') forget(entry);
}

export async function retryClone(projectPath: string): Promise<StartCloneResult> {
  const entry = entries.get(projectPath);
  if (!entry) return { success: false, error: 'That clone is no longer listed' };
  // Only a finished run can be replaced. Cancelling a live one settles its
  // `done` on its own schedule, which could drop the entry out from under the
  // run taking its place.
  if (entry.job.status !== 'failed') return { success: false, error: 'That clone is still running' };
  return startClone({ repo: entry.job.identity, parentDir: path.dirname(projectPath) }, projectPath);
}

export function cancelAllClones(): void {
  for (const projectPath of [...entries.keys()]) cancelClone(projectPath);
}
