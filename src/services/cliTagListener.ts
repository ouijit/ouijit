import log from 'electron-log/renderer';
import { terminalInstances, whenTerminalReady } from '../components/terminal/terminalRegistry';
import { collectActiveTags, terminalMatchesTag, useTerminalStore } from '../stores/terminalStore';
import { TERMINAL_READY_WAIT_MS, type CliTagListing, type CliTagOp, type CliTagResponse } from '../types';

const cliTagsLog = log.scope('cliTags');

function listing(): CliTagListing[] {
  const { order, displayStates } = useTerminalStore.getState();
  const open = order.filter((id) => {
    const instance = terminalInstances.get(id);
    return instance && !instance.isRunner;
  });
  return collectActiveTags(open, displayStates).map((name) => ({
    name,
    terminals: open
      .filter((id) => terminalMatchesTag(displayStates[id], name))
      .map((ptyId) => ({
        ptyId,
        label: displayStates[ptyId].label,
        projectPath: terminalInstances.get(ptyId)!.projectPath,
      })),
  }));
}

async function handleOp(op: CliTagOp): Promise<CliTagResponse> {
  if (op.action === 'list') return { ok: true, listing: listing() };

  const instance = op.ptyId ? await whenTerminalReady(op.ptyId, TERMINAL_READY_WAIT_MS) : null;
  if (!instance) {
    return {
      ok: false,
      error: `Session ${op.ptyId} has no terminal in this window — open its project or the home view to reconnect it`,
    };
  }

  if (op.action === 'set') {
    const tag = op.tag?.trim();
    if (!tag) return { ok: false, error: 'Missing tag' };
    instance.setTags([tag]);
  } else if (op.action === 'clear') {
    instance.setTags([]);
  }
  return { ok: true, tags: instance.tags };
}

/** Handle `ouijit tag`. Install once for the life of the renderer. */
export function installCliTagListener(): () => void {
  return window.api.cliTags.onOp((op) => {
    void handleOp(op)
      .catch((err): CliTagResponse => {
        const error = err instanceof Error ? err.message : String(err);
        cliTagsLog.warn('tag op failed', { ptyId: op.ptyId, action: op.action, error });
        return { ok: false, error };
      })
      .then((response) => window.api.cliTags.respond(op.requestId, response));
  });
}
