/**
 * The clones currently in flight, held in memory rather than in the projects
 * table.
 *
 * A cloning project is not a project yet: it has no worktree, no tasks and no
 * git. Giving the table a status column would make every consumer — task
 * creation, hooks, the CLI, the REST API — handle a state that lasts a minute
 * and must not survive a restart, and a crash would leave a row stuck in it.
 * Here, a crash leaves only a staging directory, which the next clone removes.
 *
 * Keyed by the path the project will occupy, which is unique because a clone
 * refuses to start when something already sits there.
 */

import * as path from 'node:path';
import { resolveCloneTarget, runClone, type RunningClone } from '../repoCloner';
import { registerProducedProject } from './projectRegistration';
import { getLogger } from '../logger';
import type { CloneJob, CloneProjectOptions, StartCloneResult } from '../types';

const registryLog = getLogger().scope('cloneRegistry');

interface Entry {
  job: CloneJob;
  running?: RunningClone;
}

const entries = new Map<string, Entry>();

let notify: (jobs: CloneJob[]) => void = () => {};
let announceLanded: (projectPath: string) => void = () => {};

/** Wired by the IPC layer so the registry has no BrowserWindow of its own. */
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

function update(projectPath: string, patch: Partial<CloneJob>): void {
  const entry = entries.get(projectPath);
  if (!entry) return;
  // git redraws the same percentage repeatedly; each publish re-renders the
  // whole sidebar, so an unchanged patch must not become one.
  const changed = Object.entries(patch).some(([key, value]) => entry.job[key as keyof CloneJob] !== value);
  if (!changed) return;
  entry.job = { ...entry.job, ...patch };
  publish();
}

/**
 * Begin a clone and return as soon as it is under way. The caller gets the
 * path the project will occupy so it can navigate there immediately; the
 * outcome arrives over the change and landed notifications.
 */
export async function startClone(options: CloneProjectOptions): Promise<StartCloneResult> {
  const resolved = await resolveCloneTarget(options);
  if (resolved.ok === false) return { success: false, error: resolved.error };

  const { target } = resolved;
  if (entries.has(target.projectPath)) {
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

  entry.running = runClone(target, (progress) => update(target.projectPath, progress));

  void entry.running.done.then(async (outcome) => {
    if (outcome.status === 'canceled') {
      entries.delete(target.projectPath);
      publish();
      return;
    }
    if (outcome.status === 'failed') {
      update(target.projectPath, { status: 'failed', error: outcome.error, output: entry.running?.output() });
      return;
    }

    const registered = await registerProducedProject(target.projectPath, 'cloned');
    if (registered.success === false) {
      update(target.projectPath, { status: 'failed', error: registered.error });
      return;
    }

    // Announced before the entry goes, so the renderer never sees a path with
    // neither a clone standing in for it nor a project row yet.
    announceLanded(target.projectPath);
    entries.delete(target.projectPath);
    publish();
  });

  return { success: true, projectPath: target.projectPath };
}

/** Stop a clone and drop everything it had written. */
export function cancelClone(projectPath: string): void {
  const entry = entries.get(projectPath);
  if (!entry) return;
  registryLog.info('clone canceled', { projectPath });
  entry.running?.cancel();
  // A clone that already failed has no process left to signal, so nothing
  // would remove its entry.
  if (entry.job.status === 'failed') {
    entries.delete(projectPath);
    publish();
  }
}

/**
 * Run a failed clone again, into the place it was already headed. The entry
 * holds everything that takes, so the renderer does not have to reassemble it.
 */
export async function retryClone(projectPath: string): Promise<StartCloneResult> {
  const entry = entries.get(projectPath);
  if (!entry) return { success: false, error: 'That clone is no longer listed' };
  const { identity } = entry.job;
  cancelClone(projectPath);
  return startClone({ repo: identity, parentDir: path.dirname(projectPath) });
}

/** Cancel everything in flight — the app is going away and cannot finish them. */
export function cancelAllClones(): void {
  for (const projectPath of [...entries.keys()]) cancelClone(projectPath);
}
