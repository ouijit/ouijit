import log from 'electron-log/renderer';
import type { OuijitTerminal } from '../components/terminal/terminalReact';
import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { startRunner } from '../components/terminal/terminalActions';
import { panelLabel, type TerminalPanel } from '../components/terminal/panelTypes';
import { bufferText } from '../components/terminal/terminalText';
import { projectDefaultSandbox } from '../stores/projectDataStore';
import { isActiveSandbox } from '../sandbox/types';
import {
  TERMINAL_READY_WAIT_MS,
  type CliPanelInfo,
  type CliPanelKind,
  type CliPanelOp,
  type CliPanelRead,
  type CliPanelResponse,
} from '../types';

const cliPanelsLog = log.scope('cliPanels');

const DEFAULT_READ_LINES = 100;

const INTERNAL_KIND = { markdown: 'plan', preview: 'webPreview', runner: 'runner' } as const;
const CLI_KIND = { plan: 'markdown', webPreview: 'preview', runner: 'runner' } as const;

/** The panel's own spelling of `CliPanelOp.value`. */
function panelValue(panel: TerminalPanel): string | undefined {
  if (panel.kind === 'plan') return panel.planPath;
  if (panel.kind === 'webPreview') return panel.url ?? undefined;
  return panel.scriptName ?? undefined;
}

function panelsOfKind(instance: OuijitTerminal, kind: CliPanelKind): TerminalPanel[] {
  return instance.panels.filter((p) => p.kind === INTERNAL_KIND[kind]);
}

function findPanel(instance: OuijitTerminal, kind: CliPanelKind, value: string): TerminalPanel | undefined {
  return panelsOfKind(instance, kind).find((p) => panelValue(p) === value);
}

function describe(instance: OuijitTerminal, panel: TerminalPanel): CliPanelInfo {
  const kind = CLI_KIND[panel.kind];
  const field = { markdown: 'path', preview: 'url', runner: 'script' }[kind];
  return {
    id: panel.id,
    kind,
    label: panelLabel(panel),
    [field]: panelValue(panel),
    active: panel.id === instance.activePanelId,
  };
}

/** A runner is named by its script: the CLI names one by id or name, the panel keeps the name. */
async function scriptNamed(projectPath: string, value: string) {
  const scripts = await window.api.scripts.getAll(projectPath);
  return scripts.find((s) => s.id === value) ?? scripts.find((s) => s.name === value);
}

async function add(instance: OuijitTerminal, kind: CliPanelKind, value: string): Promise<string | null> {
  if (kind === 'runner') {
    const script = await scriptNamed(instance.projectPath, value);
    if (!script) return `No script named ${value}`;
    const existing = findPanel(instance, kind, script.name);
    if (existing) {
      instance.activatePanel(existing.id);
      return null;
    }
    const sandbox = await projectDefaultSandbox(instance.projectPath);
    await startRunner(instance.ptyId, script, isActiveSandbox(sandbox) ? sandbox : undefined);
    return null;
  }
  const existing = findPanel(instance, kind, value);
  if (existing) instance.activatePanel(existing.id);
  else if (kind === 'markdown') instance.addPlanPanel(value, true);
  else instance.addWebPreviewPanel(value, { activate: true });
  return null;
}

async function remove(instance: OuijitTerminal, kind: CliPanelKind, value: string | undefined): Promise<string | null> {
  const name = kind === 'runner' && value ? ((await scriptNamed(instance.projectPath, value))?.name ?? value) : value;
  const match = name ? findPanel(instance, kind, name) : undefined;
  if (!match) return `No ${kind} panel matching ${value ?? '(none)'}`;
  instance.closePanel(match.id);
  return null;
}

function focus(instance: OuijitTerminal, id: string | undefined): string | null {
  if (id === 'terminal') {
    instance.deactivatePanel();
    return null;
  }
  if (!id || !instance.panels.some((p) => p.id === id)) return `No panel ${id ?? '(none)'}`;
  instance.activatePanel(id);
  return null;
}

function read(instance: OuijitTerminal, id: string | undefined, lines: number | undefined): CliPanelRead | string {
  const panel = instance.panels.find((p) => p.id === id);
  if (!panel) return `No panel ${id ?? '(none)'}`;
  if (panel.kind === 'plan') return { kind: 'markdown', path: panel.planPath };
  if (panel.kind === 'webPreview') return { kind: 'preview', url: panel.url ?? undefined };
  const child = instance.runnerChildren.get(panel.id);
  return {
    kind: 'runner',
    text: child ? bufferText(child.xterm, lines ?? DEFAULT_READ_LINES) : '',
    status: panel.status,
    exitCode: panel.exitCode ?? null,
  };
}

function respondWith(instance: OuijitTerminal, panels: TerminalPanel[]): CliPanelResponse {
  return { ok: true, panels: panels.map((p) => describe(instance, p)), diffOpen: instance.diffPanelOpen };
}

async function run(instance: OuijitTerminal, op: CliPanelOp): Promise<CliPanelResponse> {
  const { action, kind, value } = op;
  if (action === 'read') {
    const result = read(instance, value, op.lines);
    return typeof result === 'string' ? { ok: false, error: result } : { ok: true, read: result };
  }
  if (action === 'list-all' || action === 'focus' || action === 'diff-open' || action === 'diff-close') {
    if (action === 'focus') {
      const error = focus(instance, value);
      if (error) return { ok: false, error };
    }
    if (action === 'diff-open' || action === 'diff-close') instance.setDiffPanelOpen(action === 'diff-open');
    return respondWith(instance, instance.panels);
  }

  if (!kind) return { ok: false, error: 'Missing panel kind' };
  let error: string | null = null;
  if (action === 'add') error = value ? await add(instance, kind, value) : 'Missing value for add';
  if (action === 'remove') error = await remove(instance, kind, value);
  if (error) return { ok: false, error };
  return respondWith(instance, panelsOfKind(instance, kind));
}

async function handleOp(op: CliPanelOp): Promise<void> {
  const respond = (response: CliPanelResponse): void => {
    void window.api.cliPanels.respond(op.requestId, response);
  };

  const instance = await whenTerminalReady(op.ptyId, TERMINAL_READY_WAIT_MS);
  if (!instance) {
    respond({
      ok: false,
      error: `Session ${op.ptyId} has no terminal in this window`,
    });
    return;
  }

  try {
    respond(await run(instance, op));
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
 * Handle CLI-driven panel ops (`ouijit markdown`, `preview`, `runner`, `panel`
 * and `diff open/close`).
 *
 * Install once for the life of the renderer.
 */
export function installCliPanelListener(): () => void {
  return window.api.cliPanels.onOp((op) => void handleOp(op));
}
