import type { AskAnswer } from './types';

/** How much of a run the agent that asked for it gets back. */
export const ASK_OUTPUT_LINES = 100;

/**
 * Nobody is there to press a key for a pager, so `gh api` or `git log` would
 * wait forever. An editor still waits: turning it off would change the command.
 */
export const NO_PAGER = { PAGER: 'cat', GH_PAGER: 'cat', GIT_PAGER: 'cat' };

/** A finished run as the asker hears it. Run privately, it learns how the run ended and nothing it printed. */
export function exitedAnswer(run: {
  exitCode: number | null;
  output: string;
  privately: boolean;
  panelId?: string;
}): AskAnswer {
  const ended = { status: 'exited' as const, exitCode: run.exitCode, ...(run.panelId && { panelId: run.panelId }) };
  if (run.privately) return { ...ended, private: true };
  return { ...ended, output: run.output.split('\n').slice(-ASK_OUTPUT_LINES).join('\n').trimEnd() };
}
