import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FileDiff } from '../types';
import type { DiffSignals } from '../analysis/types';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { parseLens } from './lens';
import { LENS_SCHEMA } from './lensSchema';
import type { LensAgent } from './lensAgents';
import { buildLensPrompt, type LensFile, type LensSubject } from './lensPrompt';

const log = getLogger().scope('lens');

/**
 * One question, one answer, no session.
 *
 * The context arrives with the question, leaving a single completion — the only
 * part an agent is needed for. Anything it has to go and fetch is a tool call,
 * every tool call can want approving, and a headless run has nobody to approve
 * it; the usual outcome is an agent that talks itself out of the task.
 *
 * The run happens outside the repository, in a temporary directory. The flags
 * in `lensAgents` already stop a repository's own configuration loading, but
 * `cwd` is the part that holds however those flags are renamed next: with no
 * repository under it there is nothing for an agent to discover, and the prompt
 * carries the whole diff anyway.
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
  /** Hotspot and coupling signals, when the analysis flag is on. */
  signals?: DiffSignals | null;
  /** Already resolved: which binary, with which flags, and how it is fed. */
  agent: LensAgent;
  signal?: AbortSignal;
}

export interface RunLensResult {
  success: boolean;
  /** The parsed lens, ready to store. */
  body?: string;
  error?: string;
  /** What the run cost, where the agent says. */
  costUsd?: number;
}

export async function runLens(input: RunLensInput): Promise<RunLensResult> {
  const agent = input.agent;
  const prompt = buildLensPrompt({
    subject: input.subject,
    files: input.files,
    diffs: input.diffs,
    instruction: input.instruction,
    signals: input.signals,
  });

  const started = Date.now();
  const room = await mkdtemp(path.join(tmpdir(), 'ouijit-lens-'));

  try {
    const args = [...agent.args];
    const answerFile = path.join(room, 'lens.json');

    if (agent.schemaVia === 'inline') {
      args.push('--json-schema', JSON.stringify(LENS_SCHEMA));
    } else {
      const schemaFile = path.join(room, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(LENS_SCHEMA), 'utf8');
      args.push('--output-schema', schemaFile, '-o', answerFile);
    }

    // Enough to answer "what is it doing" without reading the code: which
    // binary, with which flags, how much was sent and how much it covers.
    log.info('lens run starting', {
      lens: input.instruction.slice(0, 60),
      command: `${agent.command} ${agent.args.join(' ')}`.trim(),
      files: input.files.length,
      promptChars: prompt.length,
    });

    const output = await capture(agent.command, args, prompt, room, input.signal);
    const answer =
      agent.schemaVia === 'inline'
        ? fromEnvelope(output)
        : { json: await readAnswerFile(answerFile), costUsd: undefined };

    log.info('lens agent replied', { command: agent.command, ms: Date.now() - started, bytes: output.length });

    if (!answer.json) {
      // The tail rather than the head: what went wrong is usually the last
      // thing said, and the first thing is usually a banner.
      log.warn('lens reply carried no lens', { reply: tail(output) });
      return { success: false, error: `No grouping in the reply. It ended: ${tail(output)}` };
    }

    const groups = parseLens(answer.json);
    if (!groups) {
      log.warn('lens reply matched the schema but named nothing', { json: answer.json.slice(0, 400) });
      return { success: false, error: 'The reply had no usable groups in it.' };
    }

    log.info('lens written', {
      ms: Date.now() - started,
      groups: groups.length,
      slices: groups.reduce((total, group) => total + group.slices.length, 0),
      costUsd: answer.costUsd,
    });
    return { success: true, body: JSON.stringify({ groups }), costUsd: answer.costUsd };
  } catch (error) {
    const message = describeError(error);
    log.warn('lens run failed to complete', { command: agent.command, ms: Date.now() - started, error: message });
    return { success: false, error: message };
  } finally {
    await rm(room, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The answer out of a `--output-format json` envelope.
 *
 * `structured_output` is the schema-checked object itself, so there is nothing
 * to parse out of prose. `permission_denials` is read for the log alone: the
 * run is told it has no tools, so anything in there means the isolation is not
 * holding and the next person to look at this should know.
 */
function fromEnvelope(output: string): { json: string | null; costUsd?: number } {
  try {
    const envelope = JSON.parse(output.trim()) as {
      structured_output?: unknown;
      total_cost_usd?: number;
      permission_denials?: unknown[];
      is_error?: boolean;
      result?: string;
    };
    if (envelope.permission_denials?.length) {
      log.warn('lens run asked for a tool', { denials: envelope.permission_denials.length });
    }
    if (envelope.is_error || envelope.structured_output == null)
      return { json: null, costUsd: envelope.total_cost_usd };
    return { json: JSON.stringify(envelope.structured_output), costUsd: envelope.total_cost_usd };
  } catch {
    return { json: null };
  }
}

async function readAnswerFile(file: string): Promise<string | null> {
  try {
    const body = (await readFile(file, 'utf8')).trim();
    return body || null;
  } catch {
    return null;
  }
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
function capture(command: string, args: string[], stdin: string, cwd: string, signal?: AbortSignal): Promise<string> {
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

    // EPIPE if the agent never reads stdin; that is its business, not a crash.
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  });
}
