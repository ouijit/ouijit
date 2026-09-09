import type { LinearStateType } from '../../linear/types';

/**
 * The glyph for a workflow state's type.
 *
 * Linear draws the type, not only the colour — a dashed ring for the backlog, a
 * half-filled one for work under way — and a list where every row is the same
 * circle in a different colour cannot be scanned without reading it. The names
 * of a team's states are its own; the seven types are not, which is why the
 * mapping keys on them.
 */
const GLYPHS: Record<LinearStateType, string> = {
  triage: 'warning-circle',
  backlog: 'circle-dashed',
  unstarted: 'circle',
  started: 'circle-half',
  completed: 'check-circle',
  canceled: 'x-circle',
  duplicate: 'prohibit',
};

export function stateGlyph(type: LinearStateType): string {
  return GLYPHS[type] ?? 'circle';
}
