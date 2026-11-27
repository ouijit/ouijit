import log from 'electron-log/renderer';
import type { RegisteredTerminal } from '../components/terminal/terminalTypes';
import { whenTerminalReady } from '../components/terminal/terminalRegistry';
import { homePanelHost } from '../components/chat/homeChatPanels';
import { isHomeChat } from '../stores/homeChatStore';
import { startRunner, startShell } from '../components/terminal/terminalActions';
import { panelLabel, type TerminalPanel } from '../components/terminal/panelTypes';
import { bufferText } from '../components/terminal/terminalText';
import { projectDefaultSandbox } from '../stores/projectDataStore';
import { isActiveSandbox, sameSandbox, type SandboxPlacement, type SandboxSpec } from '../sandbox/types';
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
  if (panel.kind === 'newTab') return undefined;
  return panel.scriptName ?? undefined;
}

function panelsOfKind(instance: RegisteredTerminal, kind: CliPanelKind): TerminalPanel[] {
  return instance.panels.filter((p) => p.kind === INTERNAL_KIND[kind]);
}

function findPanel(instance: RegisteredTerminal, kind: CliPanelKind, value: string): TerminalPanel | undefined {
  return panelsOfKind(instance, kind).find((p) => panelValue(p) === value);
}

function describe(instance: RegisteredTerminal, panel: Exclude<TerminalPanel, { kind: 'newTab' }>): CliPanelInfo {
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

async function add(
  instance: RegisteredTerminal,
  kind: CliPanelKind,
  value: string,
  sandbox?: SandboxSpec | 'none',
  shell?: boolean,
): Promise<string | null> {
  if (kind === 'runner' && shell) {
    const existing = instance.panels.find((p) => p.kind === 'runner' && p.shell);
    if (existing) instance.activatePanel(existing.id);
    else {
      const projectDefault = await projectDefaultSandbox(instance.projectPath);
      await startShell(instance.ptyId, sandbox ?? (isActiveSandbox(projectDefault) ? projectDefault : undefined));
    }
    return null;
  }
  if (kind === 'runner') {
    const script = await scriptNamed(instance.projectPath, value);
    if (!script) return `No script named ${value}`;
    const existing = findPanel(instance, kind, script.name);
    if (existing) {
      instance.activatePanel(existing.id);
      return null;
    }
    const placement = sandbox ?? (await projectDefaultSandbox(instance.projectPath));
    // The project's default host leaves the card to decide; an asked-for host is the host.
    await startRunner(instance.ptyId, script, placement === 'none' && !sandbox ? undefined : placement);
    return null;
  }
  const existing = findPanel(instance, kind, value);
  if (existing) instance.activatePanel(existing.id);
  else if (kind === 'markdown') instance.addPlanPanel(value, true);
  else instance.addWebPreviewPanel(value, { activate: true });
  return null;
}

async function remove(
  instance: RegisteredTerminal,
  kind: CliPanelKind,
  value: string | undefined,
): Promise<string | null> {
  const name = kind === 'runner' && value ? ((await scriptNamed(instance.projectPath, value))?.name ?? value) : value;
  const match = name ? findPanel(instance, kind, name) : undefined;
  if (!match) return `No ${kind} panel matching ${value ?? '(none)'}`;
  instance.closePanel(match.id);
  return null;
}

function focus(instance: RegisteredTerminal, id: string | undefined): string | null {
  if (id === 'terminal') {
    instance.deactivatePanel();
    return null;
  }
  if (!id || !instance.panels.some((p) => p.id === id)) return `No panel ${id ?? '(none)'}`;
  instance.activatePanel(id);
  return null;
}

/** Where a runner runs, as its session resolved it: a backend alone runs under its project's settings. */
function runsIn(placement: SandboxPlacement | undefined, projectPath: string): SandboxSpec | null {
  if (typeof placement === 'object') return placement;
  return isActiveSandbox(placement) ? { provider: placement, settings: projectPath } : null;
}

function read(instance: RegisteredTerminal, op: CliPanelOp): CliPanelRead | string {
  const { value: id, lines } = op;
  const panel = instance.panels.find((p) => p.id === id);
  if (!panel || panel.kind === 'newTab') return `No panel ${id ?? '(none)'}`;
  // A shell outside the reader's sandbox may be the user's own, typing on their computer.
  if (
    panel.kind === 'runner' &&
    panel.shell &&
    op.readerSandbox !== undefined &&
    !(panel.askedBy && panel.askedBy === op.readerPtyId) &&
    (!op.readerSandbox || !sameSandbox(runsIn(panel.sandbox, instance.projectPath), op.readerSandbox))
  ) {
    return `The shell ${panel.id} runs outside your sandbox`;
  }
  if (panel.kind === 'plan') return { kind: 'markdown', path: panel.planPath };
  if (panel.kind === 'webPreview') return { kind: 'preview', url: panel.url ?? undefined };
  const ended = { status: panel.status, exitCode: panel.exitCode ?? null };
  if (panel.private) return { kind: 'runner', ...ended, private: true };
  const child = instance.runnerChildren.get(panel.id);
  return { kind: 'runner', text: child ? bufferText(child.xterm, lines ?? DEFAULT_READ_LINES) : '', ...ended };
}

function respondWith(instance: RegisteredTerminal, panels: TerminalPanel[]): CliPanelResponse {
  const described = panels.flatMap((p) => (p.kind === 'newTab' ? [] : [describe(instance, p)]));
  return { ok: true, panels: described, diffOpen: instance.diffPanelOpen };
}

async function run(instance: RegisteredTerminal, op: CliPanelOp): Promise<CliPanelResponse> {
  const { action, kind, value } = op;
  if (action === 'read') {
    const result = read(instance, op);
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
  if (action === 'add')
    error = value ? await add(instance, kind, value, op.sandbox, op.shell) : 'Missing value for add';
  if (action === 'remove') error = await remove(instance, kind, value);
  if (error) return { ok: false, error };
  return respondWith(instance, panelsOfKind(instance, kind));
}

async function handleOp(op: CliPanelOp): Promise<void> {
  const respond = (response: CliPanelResponse): void => {
    void window.api.cliPanels.respond(op.requestId, response);
  };

  const instance = isHomeChat(op.ptyId)
    ? await homePanelHost(op.ptyId)
    : await whenTerminalReady(op.ptyId, TERMINAL_READY_WAIT_MS);
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
