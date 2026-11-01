/**
 * Record an agent's stdio once against the real binary, then replay it, so a
 * driver test cannot drift from the protocol the way a hand-written fake can.
 *
 * Replay is gated rather than strictly ordered: a client may send its requests
 * in a different order than it did while recording (metadata calls race the
 * first prompt), so each recorded agent line waits only until as many client
 * lines have arrived as had arrived before it was recorded, and a response
 * waits for the request it answers. Ids the client mints (JSON-RPC ids, control
 * request ids, message uuids) are mapped from the recording onto the live run.
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { onLines, spawnAgentProcess, type AgentProcess } from '../../../chat/process';

export interface CassetteEntry {
  dir: 'in' | 'out';
  line: string;
}

export interface Cassette {
  agent: string;
  version?: string;
  entries: CassetteEntry[];
}

const CASSETTE_DIR = path.join(__dirname, 'cassettes');

export const recording = process.env.RECORD_CASSETTES === '1';

export function cassettePath(name: string): string {
  return path.join(CASSETTE_DIR, `${name}.json`);
}

export function loadCassette(name: string): Cassette {
  return JSON.parse(readFileSync(cassettePath(name), 'utf8')) as Cassette;
}

/** The cassettes of one test, one per agent process it spawned, in spawn order. */
export function loadCassettes(name: string): Cassette[] {
  const cassettes: Cassette[] = [];
  for (let index = 0; existsSync(cassettePath(spawnName(name, index))); index++) {
    cassettes.push(loadCassette(spawnName(name, index)));
  }
  return cassettes;
}

function spawnName(name: string, index: number): string {
  return index === 0 ? name : `${name}.${index + 1}`;
}

/**
 * What an agent reports about the machine and account it runs on — sign-in,
 * installed skills and plugins, MCP servers — which a cassette checked into
 * the repo must not carry.
 */
const REDACTED_KEYS = new Set([
  'account',
  'email',
  'organization',
  'skills',
  'plugins',
  'mcp_servers',
  'slash_commands',
  'agents',
  'installationId',
  'serverName',
  'memory_paths',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
      key,
      REDACTED_KEYS.has(key)
        ? Array.isArray(inner)
          ? []
          : typeof inner === 'string'
            ? '__REDACTED__'
            : {}
        : redact(inner),
    ]),
  );
}

/** Paths that differ per machine and per run, written as placeholders; personal fields dropped. */
function scrub(line: string, cwd: string): string {
  let out = line;
  try {
    out = JSON.stringify(redact(JSON.parse(line)));
  } catch {
    // Not JSON: kept as the agent wrote it.
  }
  return out.split(cwd).join('__CWD__').split(os.homedir()).join('__HOME__').split(os.hostname()).join('__HOST__');
}

function unscrub(line: string, cwd: string): string {
  return line.split('__CWD__').join(cwd).split('__HOME__').join(os.homedir());
}

/** A spawn that runs the real agent and writes what crossed its stdio to the named cassette when it exits. */
export function recordingSpawn(name: string, agent: string, version: string | undefined): typeof spawnAgentProcess {
  let spawned = 0;
  return (file, args, cwd, env) => {
    const target = spawnName(name, spawned++);
    const proc = spawnAgentProcess(file, args, cwd, env);
    const entries: CassetteEntry[] = [];
    const write = proc.stdin.write.bind(proc.stdin);
    proc.stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
      for (const line of String(chunk).split('\n'))
        if (line.trim()) entries.push({ dir: 'in', line: scrub(line, cwd) });
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof proc.stdin.write;
    onLines(proc.stdout, (line) => entries.push({ dir: 'out', line: scrub(line, cwd) }));
    proc.once('exit', () => {
      mkdirSync(CASSETTE_DIR, { recursive: true });
      writeFileSync(
        cassettePath(target),
        JSON.stringify({ agent, version, entries } satisfies Cassette, null, 1) + '\n',
      );
    });
    return proc;
  };
}

type Json = Record<string, unknown>;

function parse(line: string): Json | null {
  try {
    return JSON.parse(line) as Json;
  } catch {
    return null;
  }
}

/** What kind of client message a line is, for pairing a live line with its recorded counterpart. */
function signature(message: Json | null): string {
  if (!message) return 'raw';
  if (typeof message.method === 'string') return `m:${message.method}`;
  const request = message.request as Json | undefined;
  if (typeof request?.subtype === 'string') return `c:${request.subtype}`;
  const response = message.response as Json | undefined;
  if (message.type === 'control_response') return `r:${String(response?.request_id ?? '')}`;
  if ('result' in message || 'error' in message) return `r:${String(message.id)}`;
  return `t:${String(message.type)}`;
}

const ID_KEYS = new Set(['id', 'request_id', 'uuid', 'clientUserMessageId']);

function collectIds(value: unknown, prefix: string, out: Map<string, string>): void {
  if (Array.isArray(value)) value.forEach((item, index) => collectIds(item, `${prefix}[${index}]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Json)) {
      const at = `${prefix}.${key}`;
      if (ID_KEYS.has(key) && (typeof inner === 'string' || typeof inner === 'number')) out.set(at, String(inner));
      else collectIds(inner, at, out);
    }
  }
}

/** The id a recorded agent line answers, if it is a response to a client request. */
function answers(message: Json | null): string | null {
  if (!message || typeof message.method === 'string') return null;
  if (message.type === 'control_response') return String((message.response as Json | undefined)?.request_id ?? '');
  if (message.type === 'response' && message.id !== undefined) return String(message.id);
  if (('result' in message || 'error' in message) && message.id !== undefined) return String(message.id);
  return null;
}

/** A spawn that plays cassettes back in place of the agent, the next one for each process spawned. */
export function replayingSpawn(cassettes: Cassette[]): typeof spawnAgentProcess & { pending(): string[] } {
  const live: { unconsumed: string[] }[] = [];
  let spawned = 0;
  const spawn = ((_file: string, _args: string[], cwd: string) => {
    const cassette = cassettes[spawned++];
    if (!cassette) throw new Error(`no cassette recorded for agent process ${spawned}`);
    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const recordedIn = cassette.entries.filter((entry) => entry.dir === 'in');
    const consumed = new Set<number>();
    const ids = new Map<string, string>();
    const answered = new Set<string>();
    let received = 0;
    let exitCode: number | null = null;
    let killed = false;
    let cursor = 0;

    const outputs = (() => {
      let seenIn = 0;
      return cassette.entries.flatMap((entry) => {
        if (entry.dir === 'in') {
          seenIn++;
          return [];
        }
        return [{ line: entry.line, gate: seenIn, answers: answers(parse(entry.line)) }];
      });
    })();

    const substitute = (line: string): string => {
      let out = unscrub(line, cwd);
      for (const [recorded, actual] of ids) {
        if (recorded !== actual)
          out = out.split(`"${recorded}"`).join(`"${actual}"`).split(`:${recorded},`).join(`:${actual},`);
      }
      return out;
    };

    const pump = () => {
      while (cursor < outputs.length) {
        const next = outputs[cursor];
        if (received < next.gate) return;
        if (next.answers !== null && !answered.has(next.answers)) return;
        cursor++;
        stdout.write(substitute(next.line) + '\n');
      }
    };

    const stdin = new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).split('\n')) {
          if (!line.trim()) continue;
          const message = parse(line);
          const sig = signature(message);
          const index = recordedIn.findIndex((entry, i) => !consumed.has(i) && signature(parse(entry.line)) === sig);
          if (index !== -1) {
            consumed.add(index);
            const recordedIds = new Map<string, string>();
            const liveIds = new Map<string, string>();
            collectIds(parse(recordedIn[index].line), '', recordedIds);
            collectIds(message, '', liveIds);
            for (const [at, value] of recordedIds) {
              const actual = liveIds.get(at);
              if (actual !== undefined) ids.set(value, actual);
            }
            const recordedAnswerKey = recordedIds.get('.id') ?? recordedIds.get('.request_id');
            if (recordedAnswerKey) answered.add(recordedAnswerKey);
          }
          received++;
        }
        setImmediate(pump);
        done();
      },
    });
    live.push({
      get unconsumed() {
        return recordedIn.filter((_, i) => !consumed.has(i)).map((entry) => entry.line.slice(0, 120));
      },
    });
    setImmediate(pump);

    const proc: AgentProcess = {
      stdin,
      stdout,
      stderr,
      get killed() {
        return killed;
      },
      get exitCode() {
        return exitCode;
      },
      kill(signal) {
        if (exitCode !== null) return false;
        killed = true;
        exitCode = 1;
        stdout.end();
        stderr.end();
        setImmediate(() => events.emit('exit', null, signal));
        return true;
      },
      on: events.on.bind(events) as AgentProcess['on'],
      once: events.once.bind(events) as AgentProcess['once'],
      off: events.off.bind(events) as AgentProcess['off'],
    };
    return proc;
  }) as typeof spawnAgentProcess & { pending(): string[] };
  spawn.pending = () => live.flatMap((proc) => proc.unconsumed);
  return spawn;
}
