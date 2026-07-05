/**
 * Per-project experimental feature flags: storage key, shape, and parsing.
 *
 * Leaf module (no renderer or db imports) so both the renderer store and
 * main-process consumers share one definition of the key and shape without
 * dragging renderer dependencies across the process boundary.
 */

/** Experimental features that can be toggled per project. */
export interface ExperimentalFlags {
  /** React-flow free-form terminal canvas. */
  canvas: boolean;
  /** The nono sandbox backend (still maturing; gated off by default). */
  nono: boolean;
}

export const DEFAULT_EXPERIMENTAL_FLAGS: ExperimentalFlags = {
  canvas: false,
  nono: false,
};

/** globalSettings key holding a project's experimental flags JSON. */
export function experimentalStorageKey(projectPath: string): string {
  return 'experimental:' + projectPath;
}

/** Parse a stored flags blob, filling defaults for absent or invalid values. */
export function parseExperimentalFlags(raw: string | undefined | null): ExperimentalFlags {
  if (!raw) return { ...DEFAULT_EXPERIMENTAL_FLAGS };
  try {
    const parsed = JSON.parse(raw) as Partial<ExperimentalFlags>;
    return { ...DEFAULT_EXPERIMENTAL_FLAGS, ...parsed };
  } catch {
    return { ...DEFAULT_EXPERIMENTAL_FLAGS };
  }
}
