import { spawn as spawnChild } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, type Readable, type Writable } from 'node:stream';

/**
 * A running agent process with piped stdio. Shaped like the Claude Agent SDK's
 * `SpawnedProcess`, so the same object serves every driver, and a cassette can
 * stand in for it in tests.
 */
export interface AgentProcess {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  off(event: 'exit' | 'error', listener: (...args: never[]) => void): void;
}

export interface AgentSpawn {
  command: string;
  args: string[];
  /** Merged over the session env the host built. */
  env?: Record<string, string | undefined>;
  cwd?: string;
}

/** A plain host spawn, after the caller has sandboxed the launch. */
export function spawnAgentProcess(
  file: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): AgentProcess {
  const child = spawnChild(file, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    // Detached, so the agent leads its own process group, and a kill takes its
    // tool subprocesses (dev servers, test runners) with it.
    kill(signal) {
      if (child.pid == null) return false;
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch {
        return child.kill(signal);
      }
    },
    on: child.on.bind(child) as AgentProcess['on'],
    once: child.once.bind(child) as AgentProcess['once'],
    off: child.off.bind(child) as AgentProcess['off'],
  };
}

/**
 * Split a stream into lines on LF alone. `readline` also breaks on U+2028 and
 * U+2029, which JSON allows unescaped inside strings, so it would cut a JSON
 * line in two.
 */
export function onLines(stream: Readable, handle: (line: string) => void): () => void {
  let buffer = '';
  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.trim()) handle(line);
      newline = buffer.indexOf('\n');
    }
  };
  const onEnd = () => {
    if (buffer.trim()) handle(buffer);
    buffer = '';
  };
  stream.on('data', onData);
  stream.on('end', onEnd);
  return () => {
    stream.off('data', onData);
    stream.off('end', onEnd);
  };
}

/** Keep the last few KB of stderr, for the error shown when an agent dies on start. */
export function stderrTail(proc: AgentProcess, limit = 4096): () => string {
  let tail = '';
  proc.stderr?.on('data', (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-limit);
  });
  return () => tail.trim();
}

export function exited(proc: AgentProcess): Promise<number | null> {
  if (proc.exitCode !== null) return Promise.resolve(proc.exitCode);
  return new Promise((resolve) => proc.once('exit', (code) => resolve(code)));
}

export async function terminate(proc: AgentProcess, graceMs = 3000): Promise<void> {
  if (proc.exitCode !== null) return;
  const done = exited(proc);
  proc.kill('SIGTERM');
  const timer = setTimeout(() => proc.kill('SIGKILL'), graceMs);
  await done;
  clearTimeout(timer);
}

/**
 * A process available now that is spawned later. The Claude Agent SDK's spawn
 * hook is synchronous, while a sandboxed launch is resolved asynchronously, so
 * the SDK is handed this and the real process is wired in once it exists.
 */
export function deferredProcess(spawning: Promise<AgentProcess>): AgentProcess {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let real: AgentProcess | null = null;
  let killed = false;
  let exitCode: number | null = null;
  let queuedSignal: NodeJS.Signals | null = null;

  spawning.then(
    (proc) => {
      real = proc;
      stdin.pipe(proc.stdin);
      proc.stdout.pipe(stdout);
      proc.stderr?.pipe(stderr);
      proc.on('error', (error) => events.emit('error', error));
      proc.once('exit', (code, signal) => {
        exitCode = code ?? (signal ? 1 : 0);
        stdout.end();
        stderr.end();
        events.emit('exit', code, signal);
      });
      if (queuedSignal) proc.kill(queuedSignal);
    },
    (error: unknown) => {
      exitCode = 1;
      const failure = error instanceof Error ? error : new Error(String(error));
      stderr.end(failure.message);
      stdout.end();
      events.emit('error', failure);
      events.emit('exit', 1, null);
    },
  );

  return {
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
      killed = true;
      if (real) return real.kill(signal);
      queuedSignal = signal;
      return true;
    },
    on: events.on.bind(events) as AgentProcess['on'],
    once: events.once.bind(events) as AgentProcess['once'],
    off: events.off.bind(events) as AgentProcess['off'],
  };
}
