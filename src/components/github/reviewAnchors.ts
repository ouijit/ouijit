import type { FileDiff } from '../../types';
import type { ReviewThread } from '../../github/types';
import { anchorForLine, anchorKey } from '../../diffAnchor';

/**
 * Threads that will never render inline: no anchor line, a file this diff does
 * not include, or an anchor no rendered line offers.
 *
 * A line offers only the single anchor `anchorForLine` gives it, so a context
 * line offers RIGHT alone, while GitHub accepts a LEFT comment on the same line
 * in split view. Counting both sides would leave such a thread listed in the
 * rail and drawn nowhere.
 */
export function unanchoredThreads(
  threads: readonly ReviewThread[],
  files: readonly { path: string }[],
  diffs: ReadonlyMap<string, FileDiff | null>,
): ReviewThread[] {
  // Building the anchor set walks every line of every loaded file, once per
  // arriving batch; skip it entirely when there is nothing to place.
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
