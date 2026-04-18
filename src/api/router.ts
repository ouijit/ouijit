/**
 * REST API router for the CLI.
 *
 * Dispatches HTTP requests to the same business logic used by Electron IPC handlers.
 * Runs inside the hook server on localhost — only reachable from Ouijit terminal sessions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserWindow } from 'electron';
import * as path from 'node:path';
import { createTodoTask, createTaskWorktree } from '../worktree';
import {
  setTaskMergeTarget,
  setTaskName,
  setTaskDescription,
  getHooks,
  saveHook,
  deleteHook,
  getAllTags,
  getTaskTags,
  addTagToTask,
  removeTagFromTask,
  setTaskTags,
  getScripts,
  saveScript,
  deleteScript,
} from '../db';
import {
  beginTask,
  setTaskStatusWithHooks,
  deleteTaskWithWorktree,
  getTasksWithWorkspaces,
  getTaskWithWorkspace,
} from '../taskLifecycle';
import { getProjectList } from '../scanner';
import { getPlanPath, setPlanPath, clearPlanPath } from '../hookServer';
import { isPtyActive } from '../ptyManager';
import { typedPush } from '../ipc/helpers';
import { getLogger } from '../logger';
import { authenticateRequest, type AuthContext, type ApiScope } from '../apiAuth';

const apiLog = getLogger().scope('api');

const MAX_BODY = 65_536; // 64KB

// ── Helpers ──────────────────────────────────────────────────────────

interface ParsedRequest {
  method: string;
  segments: string[]; // URL path segments after /api/
  query: URLSearchParams;
  body: Record<string, unknown>;
  auth: AuthContext;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
      if (raw.length > MAX_BODY) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function requireProject(query: URLSearchParams): string {
  const project = query.get('project');
  if (!project) throw new HttpError(400, 'Missing ?project= query parameter');
  return project;
}

function requireInt(value: string | undefined, label: string): number {
  const n = parseInt(value ?? '', 10);
  if (isNaN(n)) throw new HttpError(400, `${label} must be an integer`);
  return n;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Route dispatch ───────────────────────────────────────────────────

type RouteHandler = (req: ParsedRequest) => Promise<unknown> | unknown;

interface Route {
  method: string;
  // Pattern segments: literal strings or ':param' placeholders
  pattern: string[];
  handler: RouteHandler;
  mutating: boolean;
  /**
   * Minimum scope required to hit this route. Defaults to 'host' so
   * sandbox-scoped callers (anything reaching us from inside a guest VM
   * via host.lima.internal) cannot hit privileged endpoints by default.
   */
  minScope: ApiScope;
}

function matchRoute(
  routes: Route[],
  method: string,
  segments: string[],
): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < route.pattern.length; i++) {
      if (route.pattern[i].startsWith(':')) {
        params[route.pattern[i].slice(1)] = segments[i];
      } else if (route.pattern[i] !== segments[i]) {
        match = false;
        break;
      }
    }
    if (match) return { route, params };
  }
  return null;
}

// ── Routes ───────────────────────────────────────────────────────────

function route(
  method: string,
  pattern: string,
  handler: RouteHandler,
  mutating = false,
  minScope: ApiScope = 'host',
): Route {
  return { method, pattern: pattern.split('/').filter(Boolean), handler, mutating, minScope };
}

const routes: Route[] = [
  // ── Tasks ────────────────────────────────────────────────────────
  route('GET', 'tasks', (r) => {
    return getTasksWithWorkspaces(requireProject(r.query));
  }),

  route('GET', 'tasks/:number', (r) => {
    const project = requireProject(r.query);
    const num = requireInt(r.segments[1], 'Task number');
    return getTaskWithWorkspace(project, num);
  }),

  route(
    'POST',
    'tasks',
    (r) => {
      const project = requireProject(r.query);
      return createTodoTask(project, r.body.name as string | undefined, r.body.prompt as string | undefined);
    },
    true,
  ),

  route(
    'POST',
    'tasks/start',
    (r) => {
      const project = requireProject(r.query);
      // Sandbox scope can't reach this route (default minScope is 'host'),
      // but double-check the intent: an unsandboxed task must never be
      // created from a sandbox-scoped caller.
      if (r.auth.scope === 'sandbox' && r.body.sandboxed === false) {
        throw new HttpError(403, 'Sandboxed sessions cannot create unsandboxed tasks');
      }
      return createTaskWorktree(
        project,
        r.body.name as string | undefined,
        r.body.prompt as string | undefined,
        r.body.branchName as string | undefined,
        r.body.sandboxed as boolean | undefined,
      );
    },
    true,
  ),

  route(
    'POST',
    'tasks/:number/start',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      return beginTask(project, num, r.body.branchName as string | undefined);
    },
    true,
  ),

  route(
    'PATCH',
    'tasks/:number/status',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      const status = r.body.status;
      if (typeof status !== 'string') throw new HttpError(400, 'Missing status in body');
      return setTaskStatusWithHooks(project, num, status as 'todo' | 'in_progress' | 'in_review' | 'done');
    },
    true,
  ),

  route(
    'PATCH',
    'tasks/:number/name',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      if (typeof r.body.name !== 'string') throw new HttpError(400, 'Missing name in body');
      return setTaskName(project, num, r.body.name);
    },
    true,
  ),

  route(
    'PATCH',
    'tasks/:number/description',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      if (typeof r.body.description !== 'string') throw new HttpError(400, 'Missing description in body');
      return setTaskDescription(project, num, r.body.description);
    },
    true,
  ),

  route(
    'PATCH',
    'tasks/:number/merge-target',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      if (typeof r.body.mergeTarget !== 'string') throw new HttpError(400, 'Missing mergeTarget in body');
      return setTaskMergeTarget(project, num, r.body.mergeTarget);
    },
    true,
  ),

  route(
    'DELETE',
    'tasks/:number',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      return deleteTaskWithWorktree(project, num);
    },
    true,
  ),

  // ── Hooks ────────────────────────────────────────────────────────
  route('GET', 'hooks', (r) => {
    return getHooks(requireProject(r.query));
  }),

  route(
    'PUT',
    'hooks/:type',
    (r) => {
      const project = requireProject(r.query);
      const type = r.segments[1];
      return saveHook(project, { ...r.body, type } as Parameters<typeof saveHook>[1]);
    },
    true,
  ),

  route(
    'DELETE',
    'hooks/:type',
    (r) => {
      const project = requireProject(r.query);
      const type = r.segments[1];
      return deleteHook(project, type as Parameters<typeof deleteHook>[1]);
    },
    true,
  ),

  // ── Tags ─────────────────────────────────────────────────────────
  route('GET', 'tags', () => {
    return getAllTags();
  }),

  route('GET', 'tasks/:number/tags', (r) => {
    const project = requireProject(r.query);
    const num = requireInt(r.segments[1], 'Task number');
    return getTaskTags(project, num);
  }),

  route(
    'POST',
    'tasks/:number/tags',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      if (typeof r.body.name !== 'string') throw new HttpError(400, 'Missing name in body');
      return addTagToTask(project, num, r.body.name);
    },
    true,
  ),

  route(
    'PUT',
    'tasks/:number/tags',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      if (!Array.isArray(r.body.tags)) throw new HttpError(400, 'Missing tags array in body');
      return setTaskTags(project, num, r.body.tags as string[]);
    },
    true,
  ),

  route(
    'DELETE',
    'tasks/:number/tags/:name',
    (r) => {
      const project = requireProject(r.query);
      const num = requireInt(r.segments[1], 'Task number');
      const tagName = decodeURIComponent(r.segments[3]);
      return removeTagFromTask(project, num, tagName);
    },
    true,
  ),

  // ── Projects ─────────────────────────────────────────────────────
  route('GET', 'projects', () => {
    return getProjectList();
  }),

  // ── Scripts ──────────────────────────────────────────────────────
  route('GET', 'scripts', (r) => {
    return getScripts(requireProject(r.query));
  }),

  route(
    'PUT',
    'scripts/:id',
    (r) => {
      const project = requireProject(r.query);
      return saveScript(project, r.body as unknown as Parameters<typeof saveScript>[1]);
    },
    true,
  ),

  route(
    'DELETE',
    'scripts/:id',
    (r) => {
      const project = requireProject(r.query);
      const id = r.segments[1];
      return deleteScript(project, id);
    },
    true,
  ),

  // ── Plan ──────────────────────────────────────────────────────────
  // These routes are host-only: the guest shouldn't be able to steer
  // the host renderer to read arbitrary .md files outside the worktree
  // by setting a plan path. Inside the guest, plans flow through the
  // `/hook` action:plan path which server-joins under ~/.claude/plans.
  route('GET', 'plan/:ptyId', (r) => {
    const ptyId = r.segments[1];
    return { ptyId, planPath: getPlanPath(ptyId) };
  }),

  route(
    'POST',
    'plan/:ptyId',
    (r) => {
      const ptyId = r.segments[1];
      const planPath = r.body.path;
      if (typeof planPath !== 'string' || !planPath) {
        throw new HttpError(400, 'Missing path in body');
      }
      if (!planPath.endsWith('.md')) {
        throw new HttpError(400, 'Plan path must be a .md file');
      }
      if (!isPtyActive(ptyId)) {
        throw new HttpError(404, `PTY ${ptyId} not found or inactive`);
      }
      const resolved = path.resolve(planPath);
      setPlanPath(ptyId, resolved);
      return { success: true, ptyId, planPath: resolved };
    },
    true,
  ),

  route(
    'DELETE',
    'plan/:ptyId',
    (r) => {
      const ptyId = r.segments[1];
      clearPlanPath(ptyId);
      return { success: true, ptyId };
    },
    true,
  ),
];

// ── Main handler ─────────────────────────────────────────────────────

export function handleApiRequest(req: IncomingMessage, res: ServerResponse, window: BrowserWindow): void {
  handleAsync(req, res, window).catch((err) => {
    apiLog.error('unhandled error', { error: err instanceof Error ? err.message : String(err) });
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  });
}

async function handleAsync(req: IncomingMessage, res: ServerResponse, window: BrowserWindow): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  // Strip /api/ prefix
  const apiPath = url.pathname.replace(/^\/api\//, '');
  const segments = apiPath.split('/').filter(Boolean);

  // Every route requires a valid per-PTY bearer token. Sandboxed VMs
  // reach us via host.lima.internal — we can't rely on loopback
  // reachability as a security boundary.
  const auth = authenticateRequest(req.headers['authorization']);
  if (!auth) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  const matched = matchRoute(routes, method, segments);
  if (!matched) {
    json(res, 404, { error: `No route for ${method} /api/${apiPath}` });
    return;
  }

  if (matched.route.minScope === 'host' && auth.scope !== 'host') {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (method !== 'GET' && method !== 'DELETE') {
    try {
      const raw = await readBody(req);
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
  }

  try {
    const result = await matched.route.handler({ method, segments, query: url.searchParams, body, auth });
    json(res, 200, { data: result });

    // Notify renderer after mutating operations
    if (matched.route.mutating && window && !window.isDestroyed()) {
      const project = url.searchParams.get('project') ?? '';
      typedPush(window, 'cli-change', {
        project,
        action: `${method} /api/${apiPath}`,
        ts: Date.now(),
      });
    }
  } catch (err) {
    if (err instanceof HttpError) {
      json(res, err.status, { error: err.message });
    } else {
      apiLog.error('handler error', {
        route: `${method} /api/${apiPath}`,
        error: err instanceof Error ? err.message : String(err),
      });
      json(res, 500, { error: err instanceof Error ? err.message : 'Internal server error' });
    }
  }
}
