export const STACK_PAGE_SIZE = 5;

export interface StackWindow {
  /** The terminals on the page shown, in stack order. */
  ids: string[];
  page: number;
  pageCount: number;
}

/** The page holding `activeId`, unless `page` asks for another. */
export function stackWindow(
  ordered: string[],
  activeId: string | undefined,
  page: number | null = null,
  pageSize = STACK_PAGE_SIZE,
): StackWindow {
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const activeIndex = activeId ? ordered.indexOf(activeId) : -1;
  const shown = Math.min(Math.max(page ?? Math.floor(Math.max(activeIndex, 0) / pageSize), 0), pageCount - 1);
  return { ids: ordered.slice(shown * pageSize, (shown + 1) * pageSize), page: shown, pageCount };
}

/** The page one step away, or null past either end. */
export function turnPage(window: StackWindow, direction: -1 | 1): number | null {
  const next = window.page + direction;
  return next >= 0 && next < window.pageCount ? next : null;
}
