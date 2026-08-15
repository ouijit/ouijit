import type { FileDiff } from '../../types';
import type { ReviewThread } from '../../github/types';
import { anchorForLine, anchorKey } from '../diff/diffAnchor';

// Re-exported for the pull request side, which reaches for its anchors here.
export { anchorKey };

/**
 * Threads that will never render inline — either they carry no anchor line at
 * all, they sit on a file this diff doesn't include (a thread left on a file
 * that a later push reverted, or one past the file cap), or their anchor is one
 * no rendered line offers.
 *
 * That last case is the subtle one: a line renders the single anchor
 * `anchorForLine` gives it, so a context line offers RIGHT and nothing else,
 * while GitHub happily takes a LEFT comment on the same line in split view.
 * Treating both of a line's numbers as offered would leave such a thread
 * counted in the rail and drawn nowhere.
 */
export function unanchoredThreads(
  threads: readonly ReviewThread[],
  files: readonly { path: string }[],
  diffs: ReadonlyMap<string, FileDiff | null>,
): ReviewThread[] {
  // Building the anchor set walks every line of every loaded file, and the
  // diffs arrive in batches, so this runs once per batch. A pull request with
  // no review comments has nothing to place, so it should not pay for that.
  if (threads.length === 0) return [];

  const renderedPaths = new Set(files.map((f) => f.path));

  const anchors = new Set<string>();
  for (const [path, diff] of diffs) {
    for (const hunk of diff?.hunks ?? []) {
      for (const line of hunk.lines) {
        const anchor = anchorForLine(line);
        if (anchor) anchors.add(anchorKey(path, anchor.line, anchor.side));
      }
    }
  }

  return threads.filter((thread) => {
    const line = thread.line ?? thread.originalLine;
    if (line == null || !renderedPaths.has(thread.path)) return true;
    // Not yet loaded is not the same as unanchorable; wait for the diff.
    if (!diffs.has(thread.path)) return false;
    return !anchors.has(anchorKey(thread.path, line, thread.side));
  });
}
