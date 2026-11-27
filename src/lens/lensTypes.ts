import type { UUID } from 'node:crypto';

export interface LensSummary {
  /**
   * Stable across a rename: a stored grouping records the lens that wrote it, and
   * the name has to be free to move without it.
   */
  id: UUID;
  name: string;
  instruction: string;
}

export interface LensInput {
  /** A claim to be editing an existing lens, not an id. Checked, never trusted. */
  id?: string;
  name: string;
  instruction: string;
}
