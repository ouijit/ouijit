import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getLogger } from '../logger';
import { hostEnv } from '../sessionEnv';
import { NO_PAGER, exitedAnswer } from '../askOutput';
import { tellConversation } from './wake';
import type { ChatDecision, ChatDecisionChoice } from './preferences';
import type { AskAnswer, AskRun } from '../types';

const decisionLog = getLogger().scope('chat:decisions');

type Unstamped<D> = D extends ChatDecision ? Omit<D, 'id' | 'at'> : never;

interface Held {
  decision: ChatDecision;
  /** `quiet` when nobody is left to tell: the conversation that asked is gone. */
  settle: (choice: ChatDecisionChoice, quiet: boolean) => Promise<void>;
}

const held = new Map<string, Held>();
const listeners = new Set<(decisions: ChatDecision[]) => void>();

export function chatDecisions(): ChatDecision[] {
  return [...held.values()].map((h) => h.decision);
}

export function onChatDecisionsChange(listener: (decisions: ChatDecision[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  const decisions = chatDecisions();
  for (const listener of listeners) listener(decisions);
}

function hold(decision: Unstamped<ChatDecision>, settle: Held['settle']): void {
  const id = randomUUID();
  held.set(id, { decision: { ...decision, id, at: Date.now() } as ChatDecision, settle });
  changed();
}

/** Decided once. False when it was already decided, here or in another window. */
export async function decide(id: string, choice: ChatDecisionChoice, quiet = false): Promise<boolean> {
  const entry = held.get(id);
  if (!entry) return false;
  held.delete(id);
  changed();
  await entry.settle(choice, quiet);
  return true;
}

function tell(from: string, text: string): void {
  tellConversation(from, text).catch((error: unknown) =>
    decisionLog.warn('outcome not delivered', { from, error: String(error) }),
  );
}

/**
 * A done or a trash from Chat, held for the user. `apply` does what the user
 * would have done had they asked for it themselves.
 */
export function holdConfirm(
  confirm: { from: string; projectPath: string; taskNumber: number; action: 'done' | 'trash' },
  apply: () => Promise<{ success: boolean; error?: string }>,
): { success: true; waiting: true; message: string } {
  const what =
    confirm.action === 'done' ? `moving T-${confirm.taskNumber} to done` : `trashing T-${confirm.taskNumber}`;
  hold({ kind: 'confirm', ...confirm }, async (choice, quiet) => {
    if (choice.kind === 'decline') {
      if (!quiet) tell(confirm.from, `the user cancelled ${what}.`);
      return;
    }
    const result = await apply().catch((error: unknown) => ({ success: false, error: String(error) }));
    tell(
      confirm.from,
      result.success ? `the user confirmed ${what}.` : `${what} failed: ${result.error ?? 'unknown error'}.`,
    );
  });
  return {
    success: true,
    waiting: true,
    message: `Waiting for the user to confirm ${what}; you will be told how they decide.`,
  };
}

/**
 * A command Chat asks to run outside its sandbox. Chat has no terminal to
 * hold a runner, so an approved run happens here, with no input: a command
 * that prompts gets an end of file rather than waiting on nobody.
 */
export function holdAsk(from: string, ask: AskRun, message: string | undefined): Promise<AskAnswer> {
  return new Promise((resolve) => {
    hold({ kind: 'ask', from, ask, ...(message && { message }) }, async (choice, quiet) => {
      let answer: AskAnswer;
      if (choice.kind === 'decline') {
        answer = { status: 'declined' };
      } else {
        const run = await runHeadless(ask.runCommand ?? ask.command, ask.cwd);
        answer = exitedAnswer({ ...run, privately: !!choice.privately });
      }
      resolve(answer);
      if (!ask.wait && !quiet) tell(from, describeOutcome(ask.command, answer));
    });
    if (!ask.wait) resolve({ status: 'pending' });
  });
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

/** A conversation deleted takes what it was waiting on with it, declined. */
export async function dropDecisionsFrom(conversation: string): Promise<void> {
  const ids = [...held.entries()].filter(([, h]) => h.decision.from === conversation).map(([id]) => id);
  for (const id of ids) await decide(id, { kind: 'decline' }, true);
}
