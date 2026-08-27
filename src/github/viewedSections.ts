/**
 * How far through a pull request the reviewer is, when a lens has split it.
 *
 * A lens can put one file in three parts of a change, and each is read on its
 * own. What survives is still a claim about the file — `viewedFiles` writes
 * paths down, and the flat list and the next lens over this change both read
 * them. A part is held apart from that only until every part of its file has
 * been marked, at which point the file itself is.
 */

/** Whether one part of one file has been read, either on its own or with the whole file. */
export function isSectionViewed(
  viewedPaths: readonly string[],
  viewedSections: readonly string[],
  section: string,
  path: string,
): boolean {
  return viewedPaths.includes(path) || viewedSections.includes(section);
}

export interface ViewedChange {
  /** Parts still marked on their own. */
  sections: string[];
  /** Set only when the file's own claim moves — every part read, or one of them unread again. */
  file?: boolean;
}

/**
 * Marking one part read, or unread.
 *
 * `siblings` is every part of that file on screen, including this one. Without
 * a lens a file is its own only part, and this reduces to marking the file.
 */
export function markSection(
  viewedPaths: readonly string[],
  viewedSections: readonly string[],
  siblings: readonly string[],
  section: string,
  path: string,
  next: boolean,
): ViewedChange {
  const marks = new Set(viewedSections);
  const whole = viewedPaths.includes(path);

  if (!next) {
    if (!whole) {
      marks.delete(section);
      return { sections: [...marks] };
    }
    // The file was claimed whole, so the parts it was rolled up from were let
    // go. Unreading one hands the others back rather than losing them.
    for (const sibling of siblings) if (sibling !== section) marks.add(sibling);
    marks.delete(section);
    return { sections: [...marks], file: false };
  }

  if (whole) return { sections: [...marks] };
  marks.add(section);
  if (!siblings.every((sibling) => marks.has(sibling))) return { sections: [...marks] };

  for (const sibling of siblings) marks.delete(sibling);
  return { sections: [...marks], file: true };
}
