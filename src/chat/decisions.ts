import { spawn } from 'node:child_process';
import { getLogger } from '../logger';
import { hostEnv } from '../sessionEnv';
import { NO_PAGER, exitedAnswer } from '../askOutput';
import { hold } from '../decisions';
import { tellConversation } from './wake';
import type { WakeNote } from './model';
import type { AskAnswer, AskRun } from '../types';

const decisionLog = getLogger().scope('chat:decisions');

const youDid = (text: string): WakeNote => ({ kind: 'decision', text });

function tell(from: string, text: string, note: WakeNote): void {
  tellConversation(from, text, note).catch((error: unknown) =>
    decisionLog.warn('outcome not delivered', { from, error: String(error) }),
  );
}

/**
 * A command Chat asks to run outside its sandbox. Chat has no terminal to
 * hold a runner, so an approved run happens here, with no input: a command
 * that prompts gets an end of file rather than waiting on nobody.
 */
export function holdAsk(
  from: string,
  ask: AskRun,
  message: string | undefined,
  sandboxed: boolean,
): Promise<AskAnswer> {
  return new Promise((resolve) => {
    hold(
      { kind: 'ask', from, ask, ...(message && { message }), ...(sandboxed && { sandboxed }) },
      async (choice, quiet) => {
        let answer: AskAnswer;
        if (choice.kind === 'decline') {
          answer = { status: 'declined' };
        } else {
          const run = await runHeadless(ask.runCommand ?? ask.command, ask.cwd);
          answer = exitedAnswer({ ...run, privately: !!choice.privately });
        }
        resolve(answer);
        if (!ask.wait && !quiet)
          tell(from, describeOutcome(ask.command, answer), youDid(outcomeNote(ask.command, answer)));
      },
    );
    if (!ask.wait) resolve({ status: 'pending' });
  });
}

function outcomeNote(command: string, answer: AskAnswer): string {
  if (answer.status !== 'exited') return `You declined to run \`${command}\``;
  const how = 'private' in answer ? 'privately' : 'on your computer';
  return `You ran \`${command}\` ${how} · exit ${answer.exitCode ?? 'unknown'}`;
}

function describeOutcome(command: string, answer: AskAnswer): string {
  if (answer.status !== 'exited') return `the user declined to run \`${command}\`.`;
  if ('private' in answer) return `the user ran \`${command}\` privately; it exited with ${answer.exitCode}.`;
  return `the user ran \`${command}\`; it exited with ${answer.exitCode}.\n\n${answer.output}`;
}

/** Keeps the tail: what the asker gets back is the last lines. */
const MAX_BUFFERED = 200_000;

function runHeadless(command: string, cwd: string): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...hostEnv(), ...NO_PAGER },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > MAX_BUFFERED) output = output.slice(-MAX_BUFFERED / 2);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (error) => {
      output += `${error.message}\n`;
      resolve({ exitCode: null, output });
    });
    child.on('close', (exitCode) => resolve({ exitCode, output }));
  });
}
