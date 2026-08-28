import type { FileDiff } from '../types';
import type { LensFile, LensSubject } from './lensPrompt';

/**
 * Only the steps a pull request and a worktree differ on. The procedures that
 * drive them are `writeLens` and `readLens`, and there is one of each.
 */
export interface DiffSubject {
  projectPath: string;
  /** Only ever compared: the store holds it as an opaque string. */
  key: string;
  /** "No files" means something different for each kind of diff. */
  emptyMessage: string;

  listFiles(): Promise<{ files: LensFile[]; error?: string }>;

  /**
   * Read here rather than taken from the renderer's copy, which may still be
   * loading: a lens over half-arrived diffs is a lens over whichever files
   * happened to be first.
   */
  diffFor(file: LensFile): Promise<FileDiff | null>;

  /**
   * Compared against the stored pin, never parsed. `files` is the caller saying
   * it has already listed them, which otherwise costs a status poll.
   */
  pin(files?: LensFile[]): Promise<string>;

  /**
   * `drop` for a pull request, whose hunks are gone after a force-push. `render`
   * for a working tree, which moves on every save: `resolveLens` puts what the
   * lens no longer claims in a trailing group, so drift costs grouping rather
   * than hiding a change.
   */
  whenStale: 'drop' | 'render';

  describe(): LensSubject;
}
