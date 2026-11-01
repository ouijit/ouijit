/**
 * The HTTP half of a cassette, for an agent (opencode) that prints a server URL
 * on stdout and then talks HTTP and server-sent events. Recording puts a proxy
 * between the driver and the real server; replay serves the recorded exchanges
 * from a server of its own. Both write and read the same entry list as the
 * stdio half, so gating works across the two.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CassetteEntry } from './cassette';

export const URL_PLACEHOLDER = '__URL__';

interface HttpRequestLine {
  http: { seq: number; method: string; path: string; body: string };
}

interface HttpResponseLine {
  http: { re: number; status: number; body: string; sse?: true };
}

interface SseLine {
  sse: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

/** A proxy to `target` that appends every exchange to `entries`. Resolves with its own URL. */
export async function recordingProxy(
  target: string,
  entries: CassetteEntry[],
  scrub: (line: string) => string,
): Promise<{ url: string; close: () => void }> {
  let seq = 0;
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const n = seq++;
    const path = req.url ?? '/';
    entries.push({
      dir: 'in',
      line: scrub(JSON.stringify({ http: { seq: n, method: req.method ?? 'GET', path, body } })),
    });
    const upstream = await fetch(new URL(path, target), {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([key, value]) => typeof value === 'string' && key !== 'host'),
      ) as Record<string, string>,
      ...(body && { body }),
    });
    const type = upstream.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream') && upstream.body) {
      entries.push({
        dir: 'out',
        line: JSON.stringify({ http: { re: n, status: upstream.status, body: '', sse: true } }),
      });
      res.writeHead(upstream.status, { 'content-type': 'text/event-stream' });
      let buffer = '';
      const decoder = new TextDecoder();
      try {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          const text = decoder.decode(chunk, { stream: true });
          res.write(text);
          buffer += text;
          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (data) entries.push({ dir: 'out', line: scrub(JSON.stringify({ sse: data })) });
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // The driver closed the stream.
      }
      res.end();
      return;
    }
    const text = await upstream.text();
    entries.push({ dir: 'out', line: scrub(JSON.stringify({ http: { re: n, status: upstream.status, body: text } })) });
    res.writeHead(upstream.status, { 'content-type': type || 'application/json' });
    res.end(text);
  });
  const url = await listen(server);
  return { url, close: () => server.close() };
}

export function isHttpLine(line: string): boolean {
  return line.startsWith('{"http":') || line.startsWith('{"sse":');
}

/**
 * Plays the HTTP entries back. `received` counts every client message across
 * stdio and HTTP, so an event recorded after a request is held until that
 * request arrives here too.
 */
export class ReplayServer {
  private server: Server;
  readonly ready: Promise<string>;
  private readonly consumed = new Set<number>();
  private readonly streams: ServerResponse[] = [];

  constructor(
    private readonly entries: CassetteEntry[],
    private readonly onRequest: () => void,
    private readonly substitute: (line: string) => string,
  ) {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.ready = listen(this.server);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await readBody(req);
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    const index = this.entries.findIndex((entry, i) => {
      if (entry.dir !== 'in' || this.consumed.has(i) || !entry.line.startsWith('{"http":')) return false;
      const recorded = (JSON.parse(this.substitute(entry.line)) as HttpRequestLine).http;
      return recorded.method === method && recorded.path === path;
    });
    if (index === -1) {
      res.writeHead(599);
      res.end(JSON.stringify({ error: `no recorded ${method} ${path}` }));
      return;
    }
    this.consumed.add(index);
    const seq = (JSON.parse(this.entries[index].line) as HttpRequestLine).http.seq;
    const response = this.entries.find(
      (entry) =>
        entry.dir === 'out' &&
        entry.line.startsWith('{"http":') &&
        (JSON.parse(entry.line) as HttpResponseLine).http.re === seq,
    );
    const recorded = response ? (JSON.parse(this.substitute(response.line)) as HttpResponseLine).http : null;
    if (recorded?.sse) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      this.streams.push(res);
    } else {
      res.writeHead(recorded?.status ?? 599, { 'content-type': 'application/json' });
      res.end(recorded?.body ?? '');
    }
    this.onRequest();
  }

  /** Deliver one recorded event. False while no client is subscribed to receive it. */
  deliver(line: string): boolean {
    const live = this.streams.filter((stream) => !stream.writableEnded);
    if (live.length === 0) return false;
    const { sse } = JSON.parse(line) as SseLine;
    for (const stream of live) stream.write(`data: ${sse}\n\n`);
    return true;
  }

  close(): void {
    for (const stream of this.streams) stream.end();
    this.server.close();
  }
}
