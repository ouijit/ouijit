import { spawn } from 'node:child_process';
import type { FileDiff } from '../types';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { parseLens } from './lens';
import type { LensAgent } from './lensAgents';
import { buildLensPrompt, extractJson, type LensFile, type LensSubject } from './lensPrompt';

const log = getLogger().scope('lens');

/**
 * One question, one answer, no session.
 *
 * A lens used to be a shell command that had to discover the pull request for
 * itself: read the environment, shell out to `gh` or `ouijit`, and write its
 * answer back through the CLI. Every one of those steps is a tool call, every
 * tool call can want approving, and a headless run has nobody to approve it —
 * so the common outcome was an agent that talked itself out of the task.
 *
 * Now the context arrives with the question. What is left is a single
 * completion, which is the only part an agent is actually needed for.
 */

/** Long enough for a large diff on a slow model, short enough to give up on a hang. */
const TIMEOUT_MS = 5 * 60 * 1000;

/** Beyond this the reply is not an answer that went slightly wrong. */
const MAX_OUTPUT_BYTES = 2_000_000;

export interface RunLensInput {
  subject: LensSubject;
  files: LensFile[];
  diffs: Map<string, FileDiff | null>;
  instruction: string;
  /** Already resolved: which binary, with which flags, and how it is fed. */
  agent: LensAgent;
  cwd: string;
  signal?: AbortSignal;
}

export interface RunLensResult {
  success: boolean;
  /** The parsed lens, ready to store. */
  body?: string;
  error?: string;
}

export async function runLens(input: RunLensInput): Promise<RunLensResult> {
  const agent = input.agent;
  const prompt = buildLensPrompt({
    subject: input.subject,
    files: input.files,
    diffs: input.diffs,
    instruction: input.instruction,
  });

  const args = agent.promptVia === 'arg' ? [...agent.args, prompt] : agent.args;
  const started = Date.now();

  // Enough to answer "what is it doing" without reading the code: which binary,
  // with which flags, how much was sent and how much of the change it covers.
  log.info('lens run starting', {
    lens: input.instruction.slice(0, 60),
    command: `${agent.command} ${agent.args.join(' ')}`.trim(),
    files: input.files.length,
    promptChars: prompt.length,
  });

  let output: string;
  try {
    output = await capture(agent.command, args, agent.promptVia === 'stdin' ? prompt : null, input.cwd, input.signal);
  } catch (error) {
    const message = describeError(error);
    log.warn('lens run failed to complete', { command: agent.command, ms: Date.now() - started, error: message });
    return { success: false, error: message };
  }

  log.info('lens agent replied', { command: agent.command, ms: Date.now() - started, bytes: output.length });

  const json = extractJson(output);
  if (!json) {
    // The tail rather than the head: what went wrong is usually the last thing
    // said, and the first thing is usually a banner.
    log.warn('lens reply had no JSON in it', { reply: tail(output) });
    return { success: false, error: `No JSON in the reply. It ended: ${tail(output)}` };
  }

  const groups = parseLens(json);
  if (!groups) {
    log.warn('lens reply was JSON but not a lens', { json: json.slice(0, 400) });
    return { success: false, error: 'The reply was JSON, but not a lens — no usable groups in it.' };
  }

  log.info('lens written', {
    ms: Date.now() - started,
    groups: groups.length,
    slices: groups.reduce((total, group) => total + group.slices.length, 0),
  });
  return { success: true, body: JSON.stringify({ groups }) };
}

function tail(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 300 ? `…${trimmed.slice(-300)}` : trimmed || '(nothing at all)';
}

/**
 * Run it and collect what it says.
 *
 * `shell: false`, so the command is a binary and its arguments are arguments —
 * the prompt contains a whole diff, and a diff through a shell is a diff full
 * of things a shell would like to interpret.
 */
function capture(
  command: string,
  args: string[],
  stdin: string | null,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, OUIJIT_LENS: '1' },
    });

    let out = '';
    let err = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const kill = () => {
      child.kill('SIGTERM');
      // The same escalation the hook runner uses: an agent that ignores SIGTERM
      // would otherwise outlive the window that asked for it.
      setTimeout(() => child.kill('SIGKILL'), 2000).unref?.();
    };

    const timer = setTimeout(() => {
      kill();
      finish(() => reject(new Error(`${command} did not answer within ${TIMEOUT_MS / 60000} minutes`)));
    }, TIMEOUT_MS);

    const onAbort = () => {
      kill();
      finish(() => reject(new Error('Cancelled')));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < MAX_OUTPUT_BYTES) out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (err.length < 8_000) err += chunk.toString();
    });

    child.on('error', (error) => {
      const message =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? `${command} is not on PATH. Pick another agent under Lenses.`
          : error.message;
      finish(() => reject(new Error(message)));
    });

    child.on('close', (code) => {
      log.info('lens agent exited', { command, code, stdout: out.length, stderr: err.length });
      // A non-zero exit with usable output still counts: some agents exit
      // non-zero on a warning they have already answered through.
      if (code !== 0 && !out.trim()) {
        finish(() => reject(new Error(`${command} exited ${code}${err.trim() ? `: ${tail(err)}` : ''}`)));
        return;
      }
      finish(() => resolve(out));
    });

    if (stdin !== null) {
      // EPIPE if the agent never reads stdin; that is its business, not a crash.
      child.stdin.on('error', () => {});
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}
