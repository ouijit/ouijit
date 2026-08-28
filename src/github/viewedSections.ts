/**
 * How far through a pull request the reviewer is, when a lens has split it. A
 * lens can put one file in three parts and each is read on its own, but what
 * survives is a claim about the file: a part is held apart only until every part
 * of its file has been marked, at which point the file itself is.
 */

export function isSectionViewed(
  viewedPaths: ReadonlySet<string>,
  viewedSections: ReadonlySet<string>,
  section: string,
  path: string,
): boolean {
  return viewedPaths.has(path) || viewedSections.has(section);
}

export interface ViewedChange {
  /** Parts still marked on their own. */
  sections: Set<string>;
  /** Set only when the file's own claim moves — every part read, or one of them unread again. */
  file?: boolean;
}

/**
 * `siblings` is every part of that file on screen, including this one. Without a
 * lens a file is its own only part, and this reduces to marking the file.
 */
export function markSection(
  viewedSections: ReadonlySet<string>,
  whole: boolean,
  siblings: readonly string[],
  section: string,
  next: boolean,
): ViewedChange {
  const marks = new Set(viewedSections);

  if (!next) {
    if (!whole) {
      marks.delete(section);
      return { sections: marks };
    }
    // The parts were let go when the file was claimed whole. Unreading one hands
    // the others back rather than losing them.
    for (const sibling of siblings) if (sibling !== section) marks.add(sibling);
    marks.delete(section);
    return { sections: marks, file: false };
  }

  if (whole) return { sections: marks };
  marks.add(section);
  if (!siblings.every((sibling) => marks.has(sibling))) return { sections: marks };

  for (const sibling of siblings) marks.delete(sibling);
  return { sections: marks, file: true };
}
