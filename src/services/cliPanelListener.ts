import log from 'electron-log/renderer';
import type { OuijitTerminal } from '../components/terminal/terminalReact';
import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { panelLabel, type TerminalPanel } from '../components/terminal/panelTypes';
import {
  CLI_PANEL_TERMINAL_WAIT_MS,
  type CliPanelInfo,
  type CliPanelKind,
  type CliPanelOp,
  type CliPanelResponse,
} from '../types';

const cliPanelsLog = log.scope('cliPanels');

/** Internal panel kind backing each CLI-facing kind. */
const INTERNAL_KIND = { markdown: 'plan', preview: 'webPreview' } as const;

/** The path or URL a CLI op addresses the panel by. */
function panelValue(panel: TerminalPanel): string | undefined {
  if (panel.kind === 'plan') return panel.planPath;
  if (panel.kind === 'webPreview') return panel.url ?? undefined;
  return undefined;
}

function panelsOfKind(instance: OuijitTerminal, kind: CliPanelKind): TerminalPanel[] {
  return instance.panels.filter((p) => p.kind === INTERNAL_KIND[kind]);
}

function findPanel(instance: OuijitTerminal, kind: CliPanelKind, value: string): TerminalPanel | undefined {
  return panelsOfKind(instance, kind).find((p) => panelValue(p) === value);
}

function panelsForKind(instance: OuijitTerminal, kind: CliPanelKind): CliPanelInfo[] {
  return panelsOfKind(instance, kind).map((p) => ({
    kind,
    label: panelLabel(p),
    ...(kind === 'markdown' ? { path: panelValue(p) } : { url: panelValue(p) }),
    active: p.id === instance.activePanelId,
  }));
}

/** Add the panel, or surface the existing one if its path/url already matches. */
function addOrActivate(instance: OuijitTerminal, kind: CliPanelKind, value: string): void {
  const existing = findPanel(instance, kind, value);
  if (existing) instance.activatePanel(existing.id);
  else if (kind === 'markdown') instance.addPlanPanel(value, true);
  else instance.addWebPreviewPanel(value, { activate: true });
}

/** Close the first panel of the kind whose path/url matches. Returns false if none. */
function removeMatching(instance: OuijitTerminal, kind: CliPanelKind, value: string | undefined): boolean {
  const match = value ? findPanel(instance, kind, value) : undefined;
  if (!match) return false;
  instance.closePanel(match.id);
  return true;
}

async function handleOp(op: CliPanelOp): Promise<void> {
  const respond = (response: CliPanelResponse): void => {
    void window.api.cliPanels.respond(op.requestId, response);
  };

  const instance = await whenTerminalReady(op.ptyId, CLI_PANEL_TERMINAL_WAIT_MS);
  if (!instance) {
    respond({
      ok: false,
      error: `Session ${op.ptyId} has no terminal in this window — open its project or the home view to reconnect it`,
    });
    return;
  }

  try {
    if (op.action === 'add') {
      if (!op.value) {
        respond({ ok: false, error: 'Missing value for add' });
        return;
      }
      addOrActivate(instance, op.kind, op.value);
    } else if (op.action === 'remove') {
      if (!removeMatching(instance, op.kind, op.value)) {
        respond({ ok: false, error: `No ${op.kind} panel matching ${op.value ?? '(none)'}` });
        return;
      }
    }
    respond({ ok: true, panels: panelsForKind(instance, op.kind) });
  } catch (err) {
    cliPanelsLog.warn('panel op failed', {
      ptyId: op.ptyId,
      action: op.action,
      error: err instanceof Error ? err.message : String(err),
    });
    respond({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Handle CLI-driven panel ops (`ouijit markdown` / `ouijit preview`).
 *
 * Installed once for the life of the renderer; ops address a terminal by ptyId
 * through the global registry.
 */
export function installCliPanelListener(): () => void {
  return window.api.cliPanels.onOp((op) => void handleOp(op));
}
