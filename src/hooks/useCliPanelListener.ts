import { useEffect } from 'react';
import log from 'electron-log/renderer';
import { terminalInstances, type OuijitTerminal } from '../components/terminal/terminalReact';
import { panelLabel } from '../components/terminal/panelTypes';
import type { CliPanelInfo, CliPanelKind, CliPanelOp, CliPanelResponse } from '../types';

const cliPanelsLog = log.scope('cliPanels');

/** Internal panel kind backing each CLI-facing kind. */
function internalKind(kind: CliPanelKind): 'plan' | 'webPreview' {
  return kind === 'markdown' ? 'plan' : 'webPreview';
}

/** Snapshot the terminal's panels of one CLI kind for the reply. */
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

function handleOp(op: CliPanelOp): void {
  const respond = (response: CliPanelResponse): void => {
    void window.api.cliPanels.respond(op.requestId, response);
  };

  const instance = terminalInstances.get(op.ptyId);
  if (!instance) {
    respond({ ok: false, error: `No open terminal for session ${op.ptyId}` });
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
 * Handle CLI-driven panel ops (`ouijit markdown` / `ouijit preview`). Mounted
 * once at the app root — ops can target any live terminal regardless of which
 * project view is on screen, so this listener is global rather than per-view.
 */
export function useCliPanelListener(): void {
  useEffect(() => window.api.cliPanels.onOp(handleOp), []);
}
