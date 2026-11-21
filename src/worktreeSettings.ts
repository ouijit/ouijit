/** A project's worktree settings, read by the main process and the renderer alike. */

export type WorktreeMode = 'quick-start' | 'clean-checkout';

export const WORKTREE_MODES: readonly WorktreeMode[] = ['quick-start', 'clean-checkout'];

export interface WorktreeSettings {
  mode: WorktreeMode;
  /** What new tasks branch from, `origin/main` say. Null branches from whatever the project has checked out. */
  base: string | null;
}

export const DEFAULT_WORKTREE_SETTINGS: WorktreeSettings = { mode: 'quick-start', base: null };

export function isWorktreeMode(value: unknown): value is WorktreeMode {
  return typeof value === 'string' && (WORKTREE_MODES as readonly string[]).includes(value);
}

export function worktreeSettingsKey(projectPath: string): string {
  return 'worktree:' + projectPath;
}

export function parseWorktreeSettings(raw: string | null | undefined): WorktreeSettings {
  let parsed: { mode?: unknown; base?: unknown } = {};
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    if (value && typeof value === 'object') parsed = value;
  } catch {
    // A value that will not parse reads as nothing stored.
  }
  return {
    mode: isWorktreeMode(parsed.mode) ? parsed.mode : DEFAULT_WORKTREE_SETTINGS.mode,
    base: typeof parsed.base === 'string' && parsed.base ? parsed.base : null,
  };
}

export function serializeWorktreeSettings(settings: WorktreeSettings): string {
  return JSON.stringify({ mode: settings.mode, ...(settings.base && { base: settings.base }) });
}
