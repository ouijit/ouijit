import type { FileDiff } from '../types';
import { saveDiffLens, startDiffLensRun, endDiffLensRun } from '../db';
import { getDiffSignals } from '../analysis/service';
import { getLogger } from '../logger';
import { resolveLensRun } from './config';
import { runLens } from './runLens';
import { beginRun, endRun } from './runRegistry';
import type { LensFile } from './lensPrompt';
import type { DiffSubject } from './subject';

const log = getLogger().scope('lens');

const DIFF_BATCH_SIZE = 10;

/**
 * Ask the configured agent to group a diff, and store what it says. The whole
 * procedure, for every kind of diff there is: what a pull request and a worktree
 * disagree about is behind `DiffSubject`.
 */
export async function writeLens(subject: DiffSubject, lensId: string): Promise<{ success: boolean; error?: string }> {
  const resolved = await resolveLensRun(subject.projectPath, lensId);
  if ('error' in resolved) return { success: false, error: resolved.error };
  const { lens, agent } = resolved;

  const listed = await subject.listFiles();
  if (listed.files.length === 0) return { success: false, error: listed.error ?? listed.emptyMessage };

  // Before the agent runs, not after: it records the diff the lens was written
  // against, and pinning to the later state would call a stale lens fresh.
  const pin = await subject.pin(listed.files);

  // Before anything is spawned: the rest happens in another process and takes a
  // minute, and a quit in between would leave no trace the reader ever asked.
  await startDiffLensRun(subject.projectPath, subject.key, lens.id);
  const abort = beginRun(subject.projectPath, subject.key, lens.id);

  try {
    log.info('gathering context for a lens', { ...subject.label, files: listed.files.length, lens: lens.name });
    const [diffs, signals] = await Promise.all([
      gather(subject, listed.files),
      // Null unless the project has the analysis flag on.
      getDiffSignals(
        subject.projectPath,
        listed.files.map((file) => file.path),
      ),
    ]);

    const result = await runLens({
      subject: subject.describe(),
      files: listed.files,
      diffs,
      instruction: lens.instruction,
      signals,
      agent,
      signal: abort.signal,
    });
    if (!result.success || !result.body) return { success: false, error: result.error };

    // Saving clears the run mark, so the clearing below is only reached by a
    // failure — which leaves whatever was already grouped alone.
    await saveDiffLens(
      subject.projectPath,
      subject.key,
      pin,
      result.body,
      { id: lens.id, name: lens.name },
      result.omitted,
    );
    return { success: true };
  } finally {
    endRun(subject.projectPath, subject.key);
    await endDiffLensRun(subject.projectPath, subject.key);
  }
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
