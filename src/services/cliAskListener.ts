import log from 'electron-log/renderer';
import { runApprovedAsk } from './askRun';
import type { CliAskResponse } from '../types';

const cliAsksLog = log.scope('cliAsks');

/** Run the asks the user approves. Install once for the life of the renderer. */
export function installCliAskListener(): () => void {
  return window.api.cliAsks.onOp((op) => {
    void runApprovedAsk(op.fromPtyId, op.ask, op.privately)
      .then((answer): CliAskResponse => ({ ok: true, answer }))
      .catch((err): CliAskResponse => {
        const error = err instanceof Error ? err.message : String(err);
        cliAsksLog.warn('ask failed', { fromPtyId: op.fromPtyId, error });
        return { ok: false, error };
      })
      .then((response) => window.api.cliAsks.respond(op.requestId, response));
  });
}
