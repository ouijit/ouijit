import type { FileDiff } from '../types';
import { saveDiffLens, startDiffLensRun, endDiffLensRun } from '../db';
import { getDiffSignals } from '../analysis/service';
import { getLogger } from '../logger';
import { resolveLensRun } from './config';
import { runLens } from './runLens';
import { beginRun, endRun } from './runRegistry';
import { announceLensChanged } from './announce';
import { buildLensPrompt, type LensFile } from './lensPrompt';
import type { DiffSubject } from './subject';
import type { LensGroup } from './lens';

const log = getLogger().scope('lens');

const DIFF_BATCH_SIZE = 10;

/** Ask the configured agent to group a diff, and store what it says. */
export async function writeLens(subject: DiffSubject, lensId: string): Promise<{ success: boolean; error?: string }> {
  try {
    return await attemptLens(subject, lensId);
  } finally {
    // Around the whole of it, not just the run: a pane that asked and then
    // reloaded has nothing else to clear its spinner.
    announceLensChanged(subject);
  }
}

async function attemptLens(subject: DiffSubject, lensId: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveLensRun(subject.projectPath, lensId);
  if ('error' in resolved) return { success: false, error: resolved.error };
  const { lens, agent } = resolved;

  const listed = await subject.listFiles();
  if (listed.files.length === 0) return { success: false, error: listed.error ?? subject.emptyMessage };

  // Before the agent runs, not after: it records the diff the lens was written
  // against, and pinning to the later state would call a stale lens fresh.
  const pin = await subject.pin(listed.files);

  // Before anything is spawned: the run takes a minute in another process, and a
  // quit in between would leave no trace the reader ever asked.
  await startDiffLensRun(subject.projectPath, subject.key, lens.id);
  const abort = beginRun(subject.projectPath, subject.key, lens.id);

  try {
    log.info('gathering context for a lens', { subject: subject.key, files: listed.files.length, lens: lens.name });
    const { prompt, omitted } = await composePrompt(subject, listed.files, lens.instruction);

    const result = await runLens({ prompt, agent, signal: abort.signal });
    if (!result.success || !result.body) return { success: false, error: result.error };

    // Saving clears the run mark, so the clearing below is only reached by a
    // failure — which leaves whatever was already grouped alone.
    await saveDiffLens(subject.projectPath, subject.key, pin, result.body, { id: lens.id, name: lens.name }, omitted);
    return { success: true };
  } finally {
    endRun(subject.projectPath, subject.key);
    await endDiffLensRun(subject.projectPath, subject.key);
  }
}

/**
 * Its own function so the diffs it was built from are unreachable once it
 * returns: they dwarf the prompt, and the run outlives them by minutes.
 */
async function composePrompt(subject: DiffSubject, files: LensFile[], instruction: string) {
  const [diffs, signals] = await Promise.all([
    gather(subject, files),
    // Null unless the project has the analysis flag on.
    getDiffSignals(
      subject.projectPath,
      files.map((file) => file.path),
    ),
  ]);
  return buildLensPrompt({ subject: subject.describe(), files, diffs, instruction, signals });
}

/** A lens written over the CLI, pinned to what the subject would have pinned it to. */
export async function postLens(subject: DiffSubject, groups: LensGroup[]): Promise<void> {
  // No name: nothing here went through one of the project's lenses.
  await saveDiffLens(subject.projectPath, subject.key, await subject.pin(), JSON.stringify({ groups }), null);
  announceLensChanged(subject);
}

/**
 * A batch at a time: each of these is a child process or an API call, and a
 * 300-file change would otherwise start 300 together.
 */
async function gather(subject: DiffSubject, files: LensFile[]): Promise<Map<string, FileDiff | null>> {
  const diffs = new Map<string, FileDiff | null>();
  for (let i = 0; i < files.length; i += DIFF_BATCH_SIZE) {
    const batch = files.slice(i, i + DIFF_BATCH_SIZE);
    const read = await Promise.all(batch.map((file) => subject.diffFor(file)));
    batch.forEach((file, at) => diffs.set(file.path, read[at]));
  }
  return diffs;
}
