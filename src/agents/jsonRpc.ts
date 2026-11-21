import { onLines, type AgentProcess } from './process';

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

export interface RpcHandlers {
  notification(method: string, params: unknown): void;
  /** Answer a request the agent sent us. Throw an RpcError to reply with an error. */
  request(method: string, params: unknown): Promise<unknown>;
}

/**
 * JSON-RPC 2.0 over newline-delimited stdio. `codex app-server` leaves the
 * `"jsonrpc"` member off its messages and accepts ours without it, so `envelope`
 * decides whether we send one.
 */
export class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed: Error | null = null;
  private readonly stopLines: () => void;

  constructor(
    private readonly proc: AgentProcess,
    private readonly handlers: RpcHandlers,
    private readonly options: { envelope: boolean; log?: (message: string, data?: Json) => void },
  ) {
    this.stopLines = onLines(proc.stdout, (line) => this.receive(line));
    proc.once('exit', (code) => this.fail(new Error(`agent exited (code ${code ?? 'signal'})`)));
    proc.once('error', (error) => this.fail(error));
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write({ id, method, ...(params !== undefined && { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.write({ method, ...(params !== undefined && { params }) });
  }

  dispose(): void {
    this.stopLines();
    this.fail(new Error('session closed'));
  }

  private write(message: Json): void {
    const body = this.options.envelope ? { jsonrpc: '2.0', ...message } : message;
    this.proc.stdin.write(JSON.stringify(body) + '\n');
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private receive(line: string): void {
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      this.options.log?.('non-JSON line from agent', { line: line.slice(0, 200) });
      return;
    }
    const id = message.id as number | string | undefined;
    const method = message.method as string | undefined;
    if (method && id !== undefined) {
      void this.answer(id, method, message.params);
    } else if (method) {
      this.handlers.notification(method, message.params);
    } else if (id !== undefined) {
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      const error = message.error as { code: number; message: string; data?: unknown } | undefined;
      if (error) waiter.reject(new RpcError(error.code, error.message, error.data));
      else waiter.resolve(message.result);
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.request(method, params);
      if (!this.closed) this.write({ id, result: result ?? null });
    } catch (error) {
      if (this.closed) return;
      const rpc = error instanceof RpcError ? error : new RpcError(-32603, String(error));
      this.write({
        id,
        error: { code: rpc.code, message: rpc.message, ...(rpc.data !== undefined && { data: rpc.data }) },
      });
    }
  }
}
