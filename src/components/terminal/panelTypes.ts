/**
 * Terminal panel model. A terminal owns an ordered list of user-managed panels
 * (runner, web preview, plan) shown as tabs, displaying one at a time as the
 * active panel. Each type can have multiple instances.
 *
 * The diff view is intentionally NOT a panel here — it's an automatic,
 * contextual takeover driven from the header (see `diffPanelOpen`), separate
 * from these user-created tabs.
 *
 * These objects are plain serializable data — the live runner child PTY is
 * tracked separately in `OuijitTerminal.runnerChildren`, keyed by panel id.
 */

export type PanelKind = 'runner' | 'webPreview' | 'plan';

export type RunnerStatus = 'running' | 'success' | 'error' | 'idle';

export interface RunnerPanel {
  id: string;
  kind: 'runner';
  /** Tab label — the script or run-hook name. */
  scriptName: string | null;
  /** The command this runner runs — the single source of truth for (re)starting
   *  and persisting it. Set for both run hooks and scripts (resolved up front). */
  scriptCommand: string | null;
  /** Live command/title for the panel header (updated from the runner's OSC title). */
  command: string | null;
  /** Where the command came from — drives the OUIJIT_HOOK_TYPE env var. A run
   *  hook and a named script are otherwise identical from here on. */
  source: 'hook' | 'script';
  status: RunnerStatus;
}

export interface WebPreviewPanel {
  id: string;
  kind: 'webPreview';
  url: string | null;
  urlAutoDetected: boolean;
  /** Runner panel that auto-published this URL, if any. */
  sourceRunnerPanelId: string | null;
}

export interface PlanPanel {
  id: string;
  kind: 'plan';
  planPath: string;
}

export type TerminalPanel = RunnerPanel | WebPreviewPanel | PlanPanel;

/** Phosphor icon name for a panel's tab/minicard. */
export function panelIcon(panel: TerminalPanel): string {
  switch (panel.kind) {
    case 'runner':
      return 'terminal';
    case 'webPreview':
      return 'globe-simple';
    case 'plan':
      return 'file-text';
  }
}

/** Short host[:port] for a preview URL, or the raw string if it won't parse. */
function previewHostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Human label for a panel's tab/minicard. */
export function panelLabel(panel: TerminalPanel): string {
  switch (panel.kind) {
    case 'runner':
      return panel.scriptName || panel.command || 'Runner';
    case 'webPreview':
      return panel.url ? previewHostLabel(panel.url) : 'Preview';
    case 'plan':
      return panel.planPath.split('/').pop() ?? 'Markdown File';
  }
}
