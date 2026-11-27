import log from 'electron-log/renderer';
import { terminalInstances, whenTerminalReady } from '../components/terminal/terminalRegistry';
import type { RegisteredTerminal } from '../components/terminal/terminalTypes';
import { addProjectTerminal, closeProjectTerminal } from '../components/terminal/terminalActions';
import { openTaskShell } from '../components/navigation';
import { bufferText, pasteable } from '../components/terminal/terminalText';
import { resumableChat } from '../components/chat/chatActions';
import { opensAsChat } from './chatSettings';
import { projectDefaultSandbox } from '../stores/projectDataStore';
import { generateId } from '../utils/ids';
import { useChatStore } from '../stores/chatStore';
import { transcriptText } from '../chat/model';
import { TERMINAL_READY_WAIT_MS, type CliTerminalOp, type CliTerminalResponse } from '../types';

const cliTerminalsLog = log.scope('cliTerminals');

const DEFAULT_READ_LINES = 100;

async function open(op: CliTerminalOp): Promise<CliTerminalResponse> {
  const projectPath = op.projectPath;
  if (!projectPath) return { ok: false, error: 'Missing project' };

  // Named here rather than found as the session that wasn't there before:
  // another terminal on the task can still be re-keying from its placeholder.
  let ptyId = generateId('pty');
  let opened: boolean;
  if (op.taskNumber != null) {
    const task = await window.api.task.getByNumber(projectPath, op.taskNumber);
    if (!task) return { ok: false, error: `Task ${op.taskNumber} not found` };
    if (!task.branch)
      return { ok: false, error: `Task ${op.taskNumber} is not started; start it with ouijit task start` };
    let chat = op.chat && { ...op.chat, id: ptyId };
    // Resumed as a chat, it picks its last conversation back up, whose id is already known.
    if (op.resume && !op.chat && (await opensAsChat(projectPath, undefined))) {
      const sandbox = op.sandbox ?? (await projectDefaultSandbox(projectPath));
      const latest = await resumableChat(projectPath, task.taskNumber, sandbox);
      if (latest) ptyId = latest.id;
      chat = { id: ptyId, ...(latest && { agent: latest.agent }) };
    }
    opened = await openTaskShell(projectPath, task, {
      mode: op.resume || op.chat ? 'resume' : 'shell',
      sandbox: op.sandbox,
      background: true,
      ptyId,
      ...(chat && { chat }),
      ...(op.chat && { fresh: 'chat' as const }),
    });
  } else {
    opened = await addProjectTerminal(projectPath, undefined, {
      ptyId,
      sandbox: op.sandbox,
      background: true,
    });
  }
  return opened ? { ok: true, ptyId } : { ok: false, error: 'The terminal did not open' };
}

/** A runner is registered under its own PTY too, so its panel's privacy has to hold here as well. */
function ranPrivately(instance: RegisteredTerminal): boolean {
  if (!instance.isRunner) return false;
  for (const parent of terminalInstances.values()) {
    for (const [panelId, child] of parent.runnerChildren) {
      if (child === instance) return parent.panels.some((p) => p.id === panelId && p.kind === 'runner' && p.private);
    }
  }
  return false;
}

async function handleOp(op: CliTerminalOp): Promise<CliTerminalResponse> {
  if (op.action === 'open') return open(op);

  const instance = op.ptyId ? await whenTerminalReady(op.ptyId, TERMINAL_READY_WAIT_MS) : null;
  if (!instance || !op.ptyId) return { ok: false, error: `Session ${op.ptyId} has no terminal in this window` };

  if (op.action === 'close') {
    closeProjectTerminal(op.ptyId);
    return { ok: true, ptyId: op.ptyId };
  }
  if (instance.surface === 'chat') return chatOp(op.ptyId, op);
  if (op.action === 'paste') {
    const text = pasteable(op.text ?? '', instance.xterm.modes.bracketedPasteMode);
    if (typeof text !== 'string') return { ok: false, error: text.error };
    if (text) instance.xterm.paste(text);
    return { ok: true, ptyId: op.ptyId };
  }
  if (ranPrivately(instance)) return { ok: false, error: 'The user ran this privately' };
  return {
    ok: true,
    ptyId: op.ptyId,
    text: bufferText(instance.xterm, op.lines ?? DEFAULT_READ_LINES),
    alternateScreen: instance.xterm.buffer.active.type === 'alternate',
  };
}

/**
 * A chat card reads as its transcript, and a paste lands in its composer
 * unsent — the same contract as a terminal, where the person presses Enter.
 */
async function chatOp(ptyId: string, op: CliTerminalOp): Promise<CliTerminalResponse> {
  if (op.action === 'paste') {
    const draft = useChatStore.getState().drafts[ptyId] ?? '';
    useChatStore.getState().setDraft(ptyId, draft + (op.text ?? ''));
    return { ok: true, ptyId };
  }
  const snapshot = useChatStore.getState().sessions[ptyId] ?? (await window.api.chat.snapshot(ptyId));
  const lines = transcriptText(snapshot?.nodes ?? []).split('\n');
  return { ok: true, ptyId, text: lines.slice(-(op.lines ?? DEFAULT_READ_LINES)).join('\n'), alternateScreen: false };
}

/** Handle `ouijit session read/paste/close` and `ouijit terminal open`. Install once for the life of the renderer. */
export function installCliTerminalListener(): () => void {
  return window.api.cliTerminals.onOp((op) => {
    void handleOp(op)
      .catch((err): CliTerminalResponse => {
        const error = err instanceof Error ? err.message : String(err);
        cliTerminalsLog.warn('terminal op failed', { ptyId: op.ptyId, action: op.action, error });
        return { ok: false, error };
      })
      .then((response) => window.api.cliTerminals.respond(op.requestId, response));
  });
}
