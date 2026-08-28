import log from 'electron-log/renderer';
import type { OuijitTerminal } from '../components/terminal/terminalReact';
import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { panelLabel } from '../components/terminal/panelTypes';
import type { CliPanelInfo, CliPanelKind, CliPanelOp, CliPanelResponse } from '../types';

const cliPanelsLog = log.scope('cliPanels');

/** Internal panel kind backing each CLI-facing kind. */
function internalKind(kind: CliPanelKind): 'plan' | 'webPreview' {
  return kind === 'markdown' ? 'plan' : 'webPreview';
}

function panelsForKind(instance: OuijitTerminal, kind: CliPanelKind): CliPanelInfo[] {
  const internal = internalKind(kind);
  const out: CliPanelInfo[] = [];
  for (const p of instance.panels) {
    if (p.kind !== internal) continue;
    out.push({
      kind,
      label: panelLabel(p),
      ...(p.kind === 'plan' ? { path: p.planPath } : {}),
      ...(p.kind === 'webPreview' ? { url: p.url ?? undefined } : {}),
      active: p.id === instance.activePanelId,
    });
  }
  return out;
}

/** Add the panel, or surface the existing one if its path/url already matches. */
function addOrActivate(instance: OuijitTerminal, kind: CliPanelKind, value: string): void {
  if (kind === 'markdown') {
    const existing = instance.panels.find((p) => p.kind === 'plan' && p.planPath === value);
    if (existing) instance.activatePanel(existing.id);
    else instance.addPlanPanel(value, true);
  } else {
    const existing = instance.panels.find((p) => p.kind === 'webPreview' && p.url === value);
    if (existing) instance.activatePanel(existing.id);
    else instance.addWebPreviewPanel(value, { activate: true });
  }
}

/** Close the first panel of the kind whose path/url matches. Returns false if none. */
function removeMatching(instance: OuijitTerminal, kind: CliPanelKind, value: string | undefined): boolean {
  if (!value) return false;
  const internal = internalKind(kind);
  const match = instance.panels.find((p) => {
    if (p.kind !== internal) return false;
    return p.kind === 'plan' ? p.planPath === value : p.url === value;
  });
  if (!match) return false;
  instance.closePanel(match.id);
  return true;
}

/**
 * How long to wait for a terminal that is still reconnecting. Must stay under
 * `REQUEST_TIMEOUT_MS` in `src/cliPanels.ts`, or the CLI sees the bridge's
 * generic timeout instead of the reason below.
 */
const TERMINAL_WAIT_MS = 3000;

async function handleOp(op: CliPanelOp): Promise<void> {
  const respond = (response: CliPanelResponse): void => {
    void window.api.cliPanels.respond(op.requestId, response);
  };

  const instance = await whenTerminalReady(op.ptyId, TERMINAL_WAIT_MS);
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
 * Installed once for the life of the renderer. Ops address a terminal by ptyId
 * and reach it through the global terminal registry, which outlives any view —
 * mounting this from a view instead drops every op aimed at a terminal shown
 * somewhere else, and the CLI sees only the bridge's timeout.
 */
export function installCliPanelListener(): () => void {
  return window.api.cliPanels.onOp((op) => void handleOp(op));
}
