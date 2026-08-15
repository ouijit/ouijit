import type { FileDiff } from '../types';
import type { LensFile, LensSubject } from './lensPrompt';

/**
 * A diff a lens can be written over.
 *
 * A pull request and a worktree's own changes are the same job to a lens: list
 * the files, read each one's diff, ask the agent, store what it says against
 * something that will later say whether it still fits. Only those four steps
 * differ between them, so only those four are here — the procedure that drives
 * them is `writeLens`, and there is one of it.
 */
export interface DiffSubject {
  /** Whose lens list this reads, and the scope a rename covers. */
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
   * What the lens is being written against, for telling later whether it still
   * fits. Compared, never parsed.
   */
  pin(files: LensFile[]): Promise<string>;

  /** How the prompt opens: what kind of thing this is, and which one. */
  describe(): LensSubject;
}
