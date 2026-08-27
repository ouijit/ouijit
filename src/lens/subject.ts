import type { FileDiff } from '../types';
import type { LensFile, LensSubject } from './lensPrompt';

/**
 * A diff a lens can be written over, and read back off.
 *
 * A pull request and a worktree's own changes are the same job to a lens: list
 * the files, read each one's diff, ask the agent, store what it says against
 * something that will later say whether it still fits. Only the steps that
 * differ between them are here — the procedures that drive them are `writeLens`
 * and `readLens`, and there is one of each.
 */
export interface DiffSubject {
  /** Whose lens list and lens agent this reads. */
  projectPath: string;
  /**
   * Where the written lens is stored, unique within the project.
   *
   * Only ever compared, so its shape is the subject's own business — the store
   * holds it as an opaque string.
   */
  key: string;
  /** Where the agent runs. */
  cwd: string;
  /** For the log line, so a run says what it is grouping. */
  label: Record<string, unknown>;

  /**
   * Every file in the diff.
   *
   * `emptyMessage` is what to tell the reader when there are none, since "no
   * files" means something different for a pull request than for a working
   * tree. `error` carries a reason the list could not be read at all.
   */
  listFiles(): Promise<{ files: LensFile[]; error?: string; emptyMessage: string }>;

  /**
   * One file's diff.
   *
   * Read here rather than taken from the renderer's copy, which may still be
   * loading — a lens written against half-arrived diffs is a lens written
   * against whichever files happened to be first.
   */
  diffFor(file: LensFile): Promise<FileDiff | null>;

  /**
   * What this diff is right now. Compared against the stored pin, never parsed.
   *
   * Both halves ask this: the write path records it, and the read path checks
   * what came back against it. `files` is the caller saying it has already
   * listed them, since working one out can otherwise cost a status poll.
   */
  pin(files?: LensFile[]): Promise<string>;

  /**
   * What to do with a lens written against a different diff than the one on
   * screen.
   *
   * `drop` for a pull request: its hunks are gone after a force-push, and
   * drawing them would be a confident description of code that is no longer
   * there. `render` for a working tree, which moves on every save — a lens
   * written a minute ago still groups most of it, and `resolveLens` puts what
   * it no longer claims in a trailing group, so drift costs grouping rather
   * than hiding a change.
   */
  whenStale: 'drop' | 'render';

  /** How the prompt opens: what kind of thing this is, and which one. */
  describe(): LensSubject;
}
