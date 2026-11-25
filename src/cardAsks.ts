import { ASK_WAIT_MS, cliAskRunRequest, cliPanelRequest } from './cliPanels';
import { hold } from './decisions';
import { getLogger } from './logger';
import type { AskAnswer, AskRun } from './types';

const cardAsksLog = getLogger().scope('cardAsks');

/**
 * A command a terminal's or task chat's agent asks to run on the host. It
 * waits here for the user; approved, it runs in a runner on the card that
 * asked, which only the window can start.
 */
export function holdCardAsk(from: string, ask: AskRun, message: string | undefined): Promise<AskAnswer> {
  const answer = new Promise<AskAnswer>((resolve) => {
    hold({ kind: 'ask', from, ask, ...(message && { message }) }, async (choice) => {
      if (choice.kind === 'decline') {
        resolve({ status: 'declined' });
        return;
      }
      const ran = await cliAskRunRequest({ fromPtyId: from, ask, privately: !!choice.privately });
      if (!ran.ok) cardAsksLog.warn('approved ask did not run', { from, error: ran.error });
      resolve(ran.answer ?? { status: 'declined' });
    });
  });
  if (!ask.wait) return Promise.resolve({ status: 'pending' });
  return Promise.race([
    answer,
    new Promise<AskAnswer>((resolve) => setTimeout(() => resolve({ status: 'pending' }), ASK_WAIT_MS).unref()),
  ]);
}

/** A page a sandboxed agent asks to open in a preview, which could reach anything the host can. */
export function holdOpen(from: string, onto: string, url: string, cwd: string, message: string | undefined): void {
  hold({ kind: 'ask', from, ask: { command: url, cwd, url }, ...(message && { message }) }, async (choice) => {
    if (choice.kind === 'decline') return;
    const opened = await cliPanelRequest({ ptyId: onto, action: 'add', kind: 'preview', value: url });
    if (!opened.ok) cardAsksLog.warn('approved preview did not open', { from, error: opened.error });
  });
}
