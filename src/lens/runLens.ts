import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { getLogger } from '../logger';
import { describeError } from '../utils/describeError';
import { parseLens } from './lens';
import { LENS_SCHEMA } from './lensSchema';
import type { LensAgent } from './lensAgents';

const log = getLogger().scope('lens');

const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 2_000_000;

export interface RunLensInput {
  prompt: string;
  agent: LensAgent;
  signal?: AbortSignal;
}

export interface RunLensResult {
  success: boolean;
  body?: string;
  error?: string;
}

export async function runLens(input: RunLensInput): Promise<RunLensResult> {
  const { agent, prompt } = input;

  const started = Date.now();
  // Outside any repository. The flags in `lensAgents` already stop one's own
  // configuration loading, but `cwd` is what holds however those are renamed
  // next: with no repository under it there is nothing to discover.
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

    log.info('lens run starting', {
      command: `${agent.command} ${agent.args.join(' ')}`.trim(),
      promptChars: prompt.length,
    });

    const output = await capture(agent.command, args, prompt, room, input.signal);
    const answer =
      agent.schemaVia === 'inline'
        ? fromEnvelope(output)
        : { json: await readAnswerFile(answerFile), listPriceUsd: undefined };

    log.info('lens agent replied', { command: agent.command, ms: Date.now() - started, bytes: output.length });

    if (!answer.json) {
      // The tail rather than the head: the first thing said is usually a banner.
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
      listPriceUsd: answer.listPriceUsd,
    });
    return { success: true, body: JSON.stringify({ groups }) };
  } catch (error) {
    const message = describeError(error);
    log.warn('lens run failed to complete', { command: agent.command, ms: Date.now() - started, error: message });
    return { success: false, error: message };
  } finally {
    await rm(room, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * `structured_output` is the schema-checked object itself. Two fields go to the
 * log and nowhere else: `permission_denials`, where anything at all means the
 * isolation is not holding, and `total_cost_usd`, which is API list price — a
 * subscription login is not charged it and Codex reports nothing comparable.
 */
function fromEnvelope(output: string): { json: string | null; listPriceUsd?: number } {
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
    if (envelope.is_error || envelope.structured_output == null) {
      return { json: null, listPriceUsd: envelope.total_cost_usd };
    }
    return { json: JSON.stringify(envelope.structured_output), listPriceUsd: envelope.total_cost_usd };
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
 * `shell: false`, so the command is a binary and its arguments are arguments:
 * the prompt is a whole diff, which is full of things a shell would interpret.
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
      // An agent that ignores SIGTERM would outlive the window that asked for it.
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
