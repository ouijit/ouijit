/**
 * HTTP client for the Ouijit REST API.
 *
 * All CLI commands go through this module to communicate with the running
 * Electron app. Uses only Node built-ins — no native dependencies.
 */

import * as http from 'node:http';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getBaseUrl(): string {
  const url = process.env['OUIJIT_API_URL'];
  if (!url) {
    console.error('ouijit: OUIJIT_API_URL not set — run from an Ouijit terminal');
    process.exit(1);
  }
  return url;
}

function request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const base = getBaseUrl();
  const url = new URL(path, base);

  const payload = body ? JSON.stringify(body) : undefined;
  const options: http.RequestOptions = {
    method,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw) as { data?: T; error?: string };
          if (res.statusCode && res.statusCode >= 400) {
            reject(new ApiError(res.statusCode, parsed.error ?? `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed.data as T);
          }
        } catch {
          reject(new ApiError(res.statusCode ?? 500, raw || 'Empty response'));
        }
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new ApiError(0, 'Cannot connect to Ouijit app — is it running?'));
      } else {
        reject(err);
      }
    });

    if (payload) req.write(payload);
    req.end();
  });
}

export function projectQuery(project: string): string {
  return '?project=' + encodeURIComponent(project);
}

export function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  return request<T>('POST', path, body);
}

export function patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>('PATCH', path, body);
}

export function put<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>('PUT', path, body);
}

export function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

export { ApiError };
