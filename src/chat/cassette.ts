/**
 * Record an agent's stdio once against the real binary, then replay it, so a
 * driver test cannot drift from the protocol the way a hand-written fake can.
 * The app replays one too, in e2e runs (`OUIJIT_E2E_CHAT`), so the window can
 * be tested against a real conversation without an agent.
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
import { onLines, spawnAgentProcess, type AgentProcess } from './process';
import { ReplayServer, URL_PLACEHOLDER, isHttpLine, recordingProxy } from './httpCassette';
import type { Cassette, CassetteEntry } from './cassetteFormat';

export function cassettePath(dir: string, name: string): string {
  return path.join(dir, `${name}.json`);
}

export function loadCassette(dir: string, name: string): Cassette {
  return JSON.parse(readFileSync(cassettePath(dir, name), 'utf8')) as Cassette;
}

/** The cassettes of one recording, one per agent process it spawned, in spawn order. */
export function loadCassettes(dir: string, name: string): Cassette[] {
  const cassettes: Cassette[] = [];
  for (let index = 0; existsSync(cassettePath(dir, spawnName(name, index))); index++) {
    cassettes.push(loadCassette(dir, spawnName(name, index)));
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
  // The real home, not os.homedir(): the integration setup points that at a temp dir.
  const home = os.userInfo().homedir;
  return out.split(cwd).join('__CWD__').split(home).join('__HOME__').split(os.hostname()).join('__HOST__');
}

function unscrub(line: string, cwd: string): string {
  return line.split('__CWD__').join(cwd).split('__HOME__').join(os.homedir());
}

/** A spawn that runs the real agent and writes what crossed its stdio to the named cassette when it exits. */
export function recordingSpawn(
  dir: string,
  name: string,
  agent: string,
  version: string | undefined,
): typeof spawnAgentProcess {
  let spawned = 0;
  return (file, args, cwd, env) => {
    const target = spawnName(name, spawned++);
    const proc = spawnAgentProcess(file, args, cwd, env);
    const started = Date.now();
    const entries: CassetteEntry[] = [];
    let exit: number | undefined;
    let stopped = false;
    const kill = proc.kill.bind(proc);
    proc.kill = (signal) => {
      stopped = true;
      return kill(signal);
    };
    // Written as it goes, not only when the agent exits: an app that quits
    // takes its agents with it before their exit is heard.
    let saving: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      if (saving) clearTimeout(saving);
      saving = null;
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        cassettePath(dir, target),
        JSON.stringify({ agent, version, entries, exit } satisfies Cassette, null, 1) + '\n',
      );
    };
    process.once('exit', save);
    const record = (entry: CassetteEntry) => {
      entries.push({ ...entry, t: Date.now() - started });
      saving ??= setTimeout(save, 500);
    };
    const write = proc.stdin.write.bind(proc.stdin);
    proc.stdin.write = ((chunk: unknown, ...rest: unknown[]) => {
      for (const line of String(chunk).split('\n')) if (line.trim()) record({ dir: 'in', line: scrub(line, cwd) });
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof proc.stdin.write;
    // An agent that prints a server URL is talked to over HTTP from then on,
    // so the URL handed to the driver is a recording proxy's.
    const toDriver = new PassThrough();
    let chain = Promise.resolve();
    let proxy: { close: () => void } | null = null;
    onLines(proc.stdout, (line) => {
      chain = chain.then(async () => {
        const url = (parse(line) as { url?: unknown } | null)?.url;
        if (typeof url === 'string' && url.startsWith('http')) {
          const recorder = await recordingProxy(url, record, (l) => scrub(l, cwd));
          proxy = recorder;
          record({ dir: 'out', line: scrub(line.split(url).join(URL_PLACEHOLDER), cwd) });
          toDriver.write(line.split(url).join(recorder.url) + '\n');
          return;
        }
        record({ dir: 'out', line: scrub(line, cwd) });
        toDriver.write(line + '\n');
      });
    });
    proc.stdout = toDriver;
    proc.once('exit', (code) => {
      if (!stopped && code !== null) exit = code;
      proxy?.close();
      process.off('exit', save);
      save();
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

/**
 * Longest wait between two recorded lines when replaying at pace. A real agent
 * can think for many seconds before its first token; a test should not.
 */
const MAX_PACED_GAP_MS = 1500;

/**
 * A spawn that plays cassettes back in place of the agent, the next one for
 * each process spawned. `paced` keeps the recorded gaps between lines, so the
 * window sees text arrive as it did, in bursts; otherwise lines go as soon as
 * their gate opens.
 */
export function replayingSpawn(
  cassettes: Cassette[],
  options: { paced?: boolean } = {},
): typeof spawnAgentProcess & { pending(): string[] } {
  const live: { unconsumed: string[] }[] = [];
  let spawned = 0;
  const spawn: typeof spawnAgentProcess = (_file, _args, cwd) => {
    const cassette = cassettes[spawned++];
    if (!cassette) throw new Error(`no cassette recorded for agent process ${spawned}`);
    const speaksHttp = cassette.entries.some((entry) => entry.line.includes(URL_PLACEHOLDER));
    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const recordedIn = cassette.entries.filter((entry) => entry.dir === 'in' && !isHttpLine(entry.line));
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
        return [{ line: entry.line, gate: seenIn, answers: answers(parse(entry.line)), t: entry.t }];
      });
    })();

    let serverUrl = '';
    const substitute = (line: string): string => {
      let out = unscrub(line, cwd).split(URL_PLACEHOLDER).join(serverUrl);
      for (const [recorded, actual] of ids) {
        if (recorded !== actual)
          out = out.split(`"${recorded}"`).join(`"${actual}"`).split(`:${recorded},`).join(`:${actual},`);
      }
      return out;
    };

    const http = speaksHttp
      ? new ReplayServer(
          cassette.entries,
          () => {
            received++;
            setImmediate(pump);
          },
          (line) => substitute(line),
        )
      : null;

    // The last line in either direction, by when it happened here and in the recording.
    let anchor = { real: Date.now(), t: 0 };
    let waiting: ReturnType<typeof setTimeout> | null = null;

    const pump = () => {
      while (cursor < outputs.length) {
        const next = outputs[cursor];
        if (next.line.startsWith('{"http":')) {
          cursor++;
          continue;
        }
        if (received < next.gate) return;
        if (next.line.startsWith('{"sse":')) {
          if (!http?.deliver(substitute(next.line))) return;
          cursor++;
          continue;
        }
        if (next.answers !== null && !answered.has(next.answers)) return;
        if (options.paced && next.t !== undefined) {
          const due = anchor.real + Math.min(Math.max(0, next.t - anchor.t), MAX_PACED_GAP_MS);
          if (due > Date.now()) {
            waiting ??= setTimeout(() => {
              waiting = null;
              pump();
            }, due - Date.now());
            return;
          }
          anchor = { real: Date.now(), t: next.t };
        }
        cursor++;
        stdout.write(substitute(next.line) + '\n');
      }
      if (cassette.exit !== undefined && exitCode === null) {
        exitCode = cassette.exit;
        stdout.end();
        stderr.end();
        setImmediate(() => events.emit('exit', cassette.exit, null));
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
            const recordedAt = recordedIn[index].t;
            if (recordedAt !== undefined) anchor = { real: Date.now(), t: recordedAt };
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
    if (http) {
      void http.ready.then((url) => {
        serverUrl = url;
        setImmediate(pump);
      });
    } else {
      setImmediate(pump);
    }

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
        if (waiting) clearTimeout(waiting);
        http?.close();
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
  };
  return Object.assign(spawn, { pending: () => live.flatMap((proc) => proc.unconsumed) });
}
