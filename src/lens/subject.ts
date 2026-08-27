import type { FileDiff } from '../types';
import type { LensFile, LensSubject } from './lensPrompt';

/**
 * A diff a lens can be written over, and read back off. Only the steps a pull
 * request and a worktree differ on are here; the procedures that drive them are
 * `writeLens` and `readLens`, and there is one of each.
 */
export interface DiffSubject {
  /** Whose lens list and lens agent this reads. */
  projectPath: string;
  /**
   * Where the written lens is stored, unique within the project. Only ever
   * compared, so the store holds it as an opaque string.
   */
  key: string;
  /** For the log line, so a run says what it is grouping. */
  label: Record<string, unknown>;

  /**
   * Every file in the diff. `emptyMessage` is what to tell the reader when there
   * are none, since "no files" means something different for a pull request than
   * for a working tree.
   */
  listFiles(): Promise<{ files: LensFile[]; error?: string; emptyMessage: string }>;

  /**
   * Read here rather than taken from the renderer's copy, which may still be
   * loading: a lens written against half-arrived diffs is a lens written against
   * whichever files happened to be first.
   */
  diffFor(file: LensFile): Promise<FileDiff | null>;

  /**
   * What this diff is right now. Compared against the stored pin, never parsed.
   * `files` is the caller saying it has already listed them, since working one
   * out can otherwise cost a status poll.
   */
  pin(files?: LensFile[]): Promise<string>;

  /**
   * What to do with a lens written against a different diff than the one on
   * screen. `drop` for a pull request, whose hunks are gone after a force-push.
   * `render` for a working tree, which moves on every save: `resolveLens` puts
   * what the lens no longer claims in a trailing group, so drift costs grouping
   * rather than hiding a change.
   */
  whenStale: 'drop' | 'render';

  /** How the prompt opens: what kind of thing this is, and which one. */
  describe(): LensSubject;
}
