/**
 * REST API router for the CLI.
 *
 * Dispatches HTTP requests to the same business logic used by Electron IPC handlers.
 * Runs inside the hook server on localhost — only reachable from Ouijit terminal sessions.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createTodoTask, createTaskWorktree } from '../worktree';
import {
  setTaskMergeTarget,
  setTaskName,
  setTaskDescription,
  getHooks,
  saveHook,
  deleteHook,
  getScripts,
  saveScript,
  deleteScript,
  getTaskByNumber,
  getGlobalSetting,
  getReviewDraft,
  findLinearDraft,
  setGlobalSetting,
} from '../db';
import {
  THEME_PREFERENCE_KEY,
  CUSTOM_THEMES_KEY,
  isThemePreference,
  parseCustomTheme,
  parseCustomThemes,
  upsertCustomTheme,
  type CustomTheme,
} from '../theme/themes';
import { PRESET_THEMES, withPresets, selectionOrphanedByDelete } from '../theme/presets';
import {
  beginTask,
  setTaskStatusWithHooks,
  trashTaskWithWorktree,
  getTasksWithWorkspaces,
  getTaskWithWorkspace,
} from '../taskLifecycle';
import {
  getAvailability as getGithubAvailability,
  getInbox as getGithubInbox,
  getPullRequest as getGithubPullRequest,
  linkTaskToPr as linkGithubTaskToPr,
  listDrafts,
  saveDraft,
  discardDraft,
  getPullRequestLens,
  setPullRequestLens,
  clearPullRequestLens,
} from '../github/service';
import {
  getIssues as getLinearIssues,
  getIssue as getLinearIssue,
  listDrafts as listLinearDrafts,
  saveDraft as saveLinearDraft,
  discardDraft as discardLinearDraft,
  linkTaskToIssue as linkTaskToLinearIssue,
  resolveIssueId as resolveLinearIssueId,
} from '../linear/service';
import { getProjectList } from '../projectList';
import { shellJoin } from '../utils/shellQuote';
import { fileItRuns } from '../askFile';
import { getCustomSandboxConfig, setCustomSandboxConfig } from '../sandbox/custom/config';
import { releaseCommand, wrapCommand } from '../sandbox/commandWrap';
import { cliPanelRequest, cliPointRequest, cliTagRequest, cliTerminalRequest } from '../cliPanels';
import {
  isPtyActive,
  getPtyTaskContext,
  getActiveSessions,
  getPtySpawnContext,
  pointingPty,
  type ActiveSession,
} from '../ptyManager';
import { getHookStatus } from '../hookServer';
import { liveNotes } from '../diffNotesService';
import { typedPush } from '../ipc/helpers';
import { getLogger } from '../logger';
import { authenticateRequest, type AuthContext } from '../apiAuth';
import type {
  AskRun,
  CliHookControl,
  CliPanelKind,
  CliTagOp,
  CliTagResponse,
  CliTerminalOp,
  CliTerminalResponse,
  CliPointOp,
  CliCaller,
  PointTarget,
  SandboxCliAccess,
  SandboxProviderId,
} from '../types';
import {
  SANDBOXABLE_HOOK_TYPES,
  SANDBOX_PROVIDER_IDS,
  isActiveSandbox,
  isSandboxBackendId,
  isSandboxCliAccess,
  isSandboxProviderId,
  sandboxCliAccessSettingKey,
} from '../sandbox/types';
import { isCaptureMode } from '../capture/captureMode';
import { handleCaptureNavigate, handleCaptureSnapshot } from '../capture/captureRoutes';

const apiLog = getLogger().scope('api');

const MAX_BODY = 65_536; // 64KB

// ── Helpers ──────────────────────────────────────────────────────────

interface ParsedRequest {
  method: string;
  segments: string[]; // URL path segments after /api/
  query: URLSearchParams;
  body: Record<string, unknown>;
  auth: AuthContext;
  window: BrowserWindow;
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

interface TaskStartResult {
  success: boolean;
  worktreePath?: string;
  task?: { taskNumber: number; branch?: string; createdAt: string };
}

function isSuccessfulStart(result: unknown): result is TaskStartResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { success?: unknown }).success === true &&
    typeof (result as { worktreePath?: unknown }).worktreePath === 'string'
  );
}

/**
 * Validate the optional hook-control fields on a task-start request body.
 * Throws HttpError on a bad request; returns the fields to forward to the
 * renderer via the `cli:task-started` push so it can bypass the start-hook
 * dialog. An empty result means "use the default dialog behavior".
 */
function parseHookControl(body: Record<string, unknown>): CliHookControl {
  const hookSandbox = parseSandbox(body.hookSandbox, 'hookSandbox');
  return { ...parseHookMode(body), ...(hookSandbox && { hookSandbox }) };
}

function parseSandbox(value: unknown, field: string): SandboxProviderId | undefined {
  if (value === undefined) return undefined;
  if (isSandboxProviderId(value)) return value;
  throw new HttpError(400, `Invalid ${field}: ${String(value)}. Must be one of: ${SANDBOX_PROVIDER_IDS.join(', ')}`);
}

function parseHookMode(body: Record<string, unknown>): Omit<CliHookControl, 'hookSandbox'> {
  const mode = body.hookMode;
  if (mode === undefined) return {};
  if (mode !== 'run' && mode !== 'skip' && mode !== 'command') {
    throw new HttpError(400, `Invalid hookMode: ${String(mode)}. Must be run, skip, or command`);
  }
  if (mode === 'command') {
    const command = body.hookCommand;
    if (typeof command !== 'string' || !command.trim()) {
      throw new HttpError(400, 'hookMode "command" requires a non-empty hookCommand');
    }
    return { hookMode: mode, hookCommand: command };
  }
  return { hookMode: mode };
}

/** A pointer's label, not a place to write: longer than a line or two is cut. */
const MAX_POINT_MESSAGE = 200;

function cliCaller(auth: AuthContext, body: Record<string, unknown>): CliCaller {
  return {
    fromPtyId: pointingPty(auth.ptyId),
    ...(body.point === true && { point: true }),
    ...(auth.scope === 'sandbox' && { fromSandbox: true }),
  };
}

/** A path's real location, through any symlink, for as much of it as exists. */
function realLocation(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realLocation(parent), path.basename(p));
  }
}

/**
 * The diff names files by their path in the worktree. The CLI sends an
 * absolute one, resolved from its shell's directory, which may have come
 * through a symlink the registered worktree path did not (macOS's /var).
 */
function pathInWorktree(ptyId: string, file: string): string {
  return worktreeRelative(ptyId, file) ?? file;
}

/** `file` relative to the terminal's worktree, or null when it lies outside it. */
function worktreeRelative(ptyId: string, file: string): string | null {
  const ctx = getPtySpawnContext(ptyId);
  const root = ctx?.worktreePath || ctx?.projectPath;
  if (!root || !path.isAbsolute(file)) return null;
  const relative = path.relative(realLocation(root), realLocation(file));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

/** The target of `ouijit point`, from its body. The project ones take `?project=`; the rest name a terminal. */
function pointTarget(r: ParsedRequest): PointTarget {
  const { body } = r;
  const ptyId = typeof body.ptyId === 'string' && body.ptyId ? body.ptyId : r.auth.ptyId;
  switch (body.kind) {
    case 'task':
      return {
        kind: 'task',
        projectPath: requireProject(r.query),
        taskNumber: requireInt(String(body.taskNumber), 'Task number'),
      };
    case 'terminal':
      if (typeof body.ptyId !== 'string' || !body.ptyId) throw new HttpError(400, 'Missing ptyId');
      return { kind: 'terminal', ptyId: body.ptyId };
    case 'project':
    case 'board':
      return { kind: body.kind, projectPath: requireProject(r.query) };
    case 'pr':
      return {
        kind: 'pr',
        projectPath: requireProject(r.query),
        number: requireInt(String(body.number), 'Pull request number'),
      };
    case 'issue':
      if (typeof body.id !== 'string' || !body.id) throw new HttpError(400, 'Missing issue');
      return { kind: 'issue', projectPath: requireProject(r.query), id: body.id };
    case 'panel':
      if (typeof body.panelId !== 'string' || !body.panelId) throw new HttpError(400, 'Missing panel id');
      return { kind: 'panel', ptyId, panelId: body.panelId };
    case 'diff': {
      if (typeof body.path !== 'string' || !body.path) throw new HttpError(400, 'Missing path');
      const line = body.line === undefined ? undefined : requireInt(String(body.line), 'Line');
      return { kind: 'diff', ptyId, path: pathInWorktree(ptyId, body.path), ...(line !== undefined && { line }) };
    }
    default:
      throw new HttpError(400, `Unknown target '${String(body.kind)}'`);
  }
}

async function runPointOp(
  op: Omit<CliPointOp, 'requestId'>,
): Promise<{ target?: PointTarget; message?: string; cleared?: boolean }> {
  const result = await cliPointRequest(op);
  if (!result.ok) throw new HttpError(404, result.error ?? 'Point failed');
  if (op.action === 'clear') return { cleared: true };
  return { target: result.target, ...(op.message && { message: op.message }) };
}

async function askRun(r: ParsedRequest): Promise<AskRun> {
  const ctx = getPtySpawnContext(r.auth.ptyId);
  if (!ctx) throw new HttpError(404, `PTY ${r.auth.ptyId} not found or inactive`);
  const cwd = ctx.worktreePath || ctx.projectPath;
  const wait = r.body.wait === true;
  const { script, argv } = r.body;
  if (typeof script === 'string' && script) {
    const scripts = await getScripts(ctx.projectPath);
    const named = scripts.find((s) => s.id === script) ?? scripts.find((s) => s.name === script);
    if (!named) throw new HttpError(404, `No script named ${script}`);
    return { command: named.command, scriptName: named.name, cwd, ...fileItRuns(named.command, cwd), wait };
  }
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
    throw new HttpError(400, 'Ask to run a script by name, or a command after --');
  }
  const command = shellJoin(argv as string[]);
  return { command, cwd, ...fileItRuns(command, cwd), wait };
}

async function readCustomThemes(): Promise<CustomTheme[]> {
  return parseCustomThemes(await getGlobalSetting(CUSTOM_THEMES_KEY));
}

function isTaskStartRoute(method: string, segments: string[]): boolean {
  if (method !== 'POST') return false;
  // POST /api/tasks/start
  if (segments.length === 2 && segments[0] === 'tasks' && segments[1] === 'start') return true;
  // POST /api/tasks/:number/start
  if (segments.length === 3 && segments[0] === 'tasks' && segments[2] === 'start') return true;
  return false;
}

function isStatusPatchRoute(method: string, segments: string[]): boolean {
  return method === 'PATCH' && segments.length === 3 && segments[0] === 'tasks' && segments[2] === 'status';
}

function isSuccessfulMutation(result: unknown): result is { success: true } {
  return typeof result === 'object' && result !== null && (result as Record<string, unknown>).success === true;
}

// ── Route dispatch ───────────────────────────────────────────────────

type RouteHandler = (req: ParsedRequest) => Promise<unknown> | unknown;

interface Route {
  method: string;
  // Pattern segments: literal strings or ':param' placeholders
  pattern: string[];
  handler: RouteHandler;
  mutating: boolean;
  sandbox?: SandboxRule;
}

/**
 * Who in a sandbox may call a route; without one, only the host may. `level`
 * is the project's Ouijit CLI access it needs. `owns` is what the request must
 * name of the caller's own: its terminal, which at "Its own task" widens to
 * every sandboxed terminal on its task, or its task, by `:number` or
 * `taskNumber`. Any `?project=` must be the caller's own project.
 *
 * A route with a rule never lets the caller choose what runs on the host, and
 * anything it runs stays in the sandbox — keep it that way when changing one.
 */
interface SandboxRule {
  level: 'read' | 'task';
  owns?: 'terminal' | 'task';
}

const READ: SandboxRule = { level: 'read' };
const OWN_TERMINAL: SandboxRule = { level: 'read', owns: 'terminal' };
const OWN_TASK: SandboxRule = { level: 'task', owns: 'task' };

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

function route(method: string, pattern: string, handler: RouteHandler, mutating = false, sandbox?: SandboxRule): Route {
  return { method, pattern: pattern.split('/').filter(Boolean), handler, mutating, sandbox };
}

// ── Pull request helpers ─────────────────────────────────────────────

function prNumber(r: ParsedRequest): number {
  return requireInt(r.segments[1], 'Pull request number');
}

/** A Linear issue id or identifier — `ENG-123` reads either way. */
function issueId(r: ParsedRequest): string {
  const id = r.segments[2];
  if (!id) throw new HttpError(400, 'Missing issue identifier');
  return id;
}

/** A sandbox edits and discards the drafts a sandbox wrote, never the user's. */
function guardSandboxDraft(r: ParsedRequest, draft: { origin: string } | undefined): void {
  if (r.auth.scope === 'sandbox' && draft && draft.origin !== 'sandbox') {
    throw new HttpError(403, "A sandboxed terminal cannot change the user's own drafts");
  }
}

/**
 * Validate the body of a draft write. Everything a comment anchors to is
 * required: a draft that lands on no line is one the review submit will reject
 * later, and finding that out at send time loses the work.
 */
function draftInput(body: Record<string, unknown>): {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  body: string;
  id?: string;
} {
  const path = body.path;
  const line = body.line;
  const text = body.body;
  if (typeof path !== 'string' || !path) throw new HttpError(400, 'Missing path');
  if (typeof line !== 'number') throw new HttpError(400, 'Missing line');
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Missing body');
  const side = body.side === 'LEFT' ? 'LEFT' : 'RIGHT';
  return {
    path,
    line,
    side,
    ...(typeof body.startLine === 'number' ? { startLine: body.startLine } : {}),
    body: text,
    ...(typeof body.id === 'string' ? { id: body.id } : {}),
  };
}

// ── Panel route helpers ──────────────────────────────────────────────

function parsePanelKind(segment: string): CliPanelKind {
  if (segment === 'markdown' || segment === 'preview' || segment === 'runner') return segment;
  throw new HttpError(404, `Unknown panel kind '${segment}' (expected 'markdown', 'preview' or 'runner')`);
}

/**
 * Validate and normalize the add/remove target for a panel kind. Markdown
 * paths are resolved to absolute so a removal matches the path a prior add
 * stored. Returns undefined for list ops (no target).
 */
function panelValue(kind: CliPanelKind, rawPath?: unknown, rawUrl?: unknown, rawScript?: unknown): string {
  if (kind === 'runner') {
    if (typeof rawScript !== 'string' || !rawScript) throw new HttpError(400, 'Missing script');
    return rawScript;
  }
  if (kind === 'markdown') {
    if (typeof rawPath !== 'string' || !rawPath) throw new HttpError(400, 'Missing path');
    if (!rawPath.endsWith('.md')) throw new HttpError(400, 'Markdown path must be a .md file');
    return path.resolve(rawPath);
  }
  if (typeof rawUrl !== 'string' || !rawUrl) throw new HttpError(400, 'Missing url');
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(400, `Invalid url: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Preview url must be http(s)');
  }
  return rawUrl;
}

function readLines(query: URLSearchParams): number | undefined {
  const lines = query.get('lines');
  return lines === null ? undefined : Math.max(1, requireInt(lines, 'lines'));
}

/** Of the panels a sandbox may add or remove, only markdown: see the panel routes. */
function sandboxPanelKind(r: ParsedRequest, kind: CliPanelKind): CliPanelKind {
  if (r.auth.scope === 'sandbox' && kind !== 'markdown') {
    throw new HttpError(403, `A sandboxed terminal cannot add or remove a ${kind} panel`);
  }
  return kind;
}

/** Forward a panel op to the renderer (via the CLI panel bridge) and shape the reply. */
async function runPanelOp(
  ptyId: string,
  action: 'list' | 'add' | 'remove',
  kind: CliPanelKind,
  value?: string,
): Promise<{ ptyId: string; kind: CliPanelKind; panels: unknown }> {
  if (!isPtyActive(ptyId)) throw new HttpError(404, `PTY ${ptyId} not found or inactive`);
  const result = await cliPanelRequest({ ptyId, action, kind, value });
  if (!result.ok) throw new HttpError(404, result.error ?? 'Panel operation failed');
  return { ptyId, kind, panels: result.panels ?? [] };
}

/** A panel op that spans every kind, or the diff, which is not a panel. */
async function runTerminalPanelsOp(
  ptyId: string,
  action: 'list-all' | 'focus' | 'diff-open' | 'diff-close',
  value?: string,
): Promise<{ ptyId: string; panels: unknown; diffOpen: boolean }> {
  if (!isPtyActive(ptyId)) throw new HttpError(404, `PTY ${ptyId} not found or inactive`);
  const result = await cliPanelRequest({ ptyId, action, value });
  if (!result.ok) throw new HttpError(404, result.error ?? 'Panel operation failed');
  return { ptyId, panels: result.panels ?? [], diffOpen: result.diffOpen ?? false };
}

async function runTerminalOp(op: Omit<CliTerminalOp, 'requestId'>): Promise<CliTerminalResponse> {
  if (op.ptyId && !isPtyActive(op.ptyId)) throw new HttpError(404, `PTY ${op.ptyId} not found or inactive`);
  const result = await cliTerminalRequest(op);
  if (!result.ok) throw new HttpError(op.action === 'paste' ? 400 : 404, result.error ?? 'Terminal operation failed');
  return result;
}

function describeTerminal(session: ActiveSession) {
  return {
    ptyId: session.ptyId,
    label: session.label,
    projectPath: session.projectPath,
    taskNumber: session.taskId ?? null,
    worktreePath: session.worktreePath ?? null,
    sandbox: session.sandboxProvider ?? 'none',
    agentStatus: getHookStatus(session.ptyId)?.status ?? null,
  };
}

/** Forward a tag op to the renderer, where a terminal's tags live. */
async function runTagOp(op: Omit<CliTagOp, 'requestId'>): Promise<CliTagResponse> {
  if (op.ptyId && !isPtyActive(op.ptyId)) throw new HttpError(404, `PTY ${op.ptyId} not found or inactive`);
  const result = await cliTagRequest(op);
  if (!result.ok) throw new HttpError(404, result.error ?? 'Tag operation failed');
  return result;
}

async function terminalTags(op: Omit<CliTagOp, 'requestId'>): Promise<{ ptyId: string; tags: string[] }> {
  const { tags } = await runTagOp(op);
  return { ptyId: op.ptyId!, tags: tags ?? [] };
}

const routes: Route[] = [
  // ── Tasks ────────────────────────────────────────────────────────
  route('GET', 'tasks', (r) => {
    return getTasksWithWorkspaces(requireProject(r.query));
  }),

  // Resolves the task owning the calling PTY. The project is derived from
  // the pty's record, so this route deliberately does not take ?project=.
  // Order matters: must come before 'tasks/:number' so the literal segment
  // wins the match against a numeric :number.
  route(
    'GET',
    'tasks/current',
    async (r) => {
      const ctx = getPtyTaskContext(r.auth.ptyId);
      if (!ctx) throw new HttpError(404, 'Current PTY is not associated with a task');
      const task = await getTaskWithWorkspace(ctx.projectPath, ctx.taskId);
      if (!task) throw new HttpError(404, `Task ${ctx.taskId} not found`);
      return task;
    },
    false,
    READ,
  ),

  route(
    'GET',
    'tasks/:number',
    (r) => {
      const project = requireProject(r.query);
      return getTaskWithWorkspace(project, requireInt(r.segments[1], 'Task number'));
    },
    false,
    { level: 'read', owns: 'task' },
  ),

  route(
    'POST',
    'tasks',
    (r) => {
      const project = requireProject(r.query);
      return createTodoTask(project, r.body.name as string | undefined, r.body.prompt as string | undefined);
    },
    true,
    // A to-do card only: starting one runs the start hook, and that route stays the host's.
    { level: 'task' },
  ),

  route(
    'POST',
    'tasks/start',
    (r) => {
      const project = requireProject(r.query);
      // Validate hook-control flags up front so a bad request fails before
      // any worktree is created. The values themselves are forwarded to the
      // renderer in the cli:task-started push below.
      parseHookControl(r.body);
      return createTaskWorktree(
        project,
        r.body.name as string | undefined,
        r.body.prompt as string | undefined,
        r.body.branchName as string | undefined,
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
      parseHookControl(r.body);
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
      if (r.auth.scope === 'sandbox' && (r.body.hookMode === 'command' || r.body.hookSandbox !== undefined)) {
        throw new HttpError(403, 'A sandboxed terminal runs the hook as configured, or none');
      }
      // in_progress / in_review / done all fire a renderer-side hook and carry
      // the same hook-control flags as task-start. Validate them up front so a
      // bad hookMode fails before any status is written.
      if (status === 'in_progress' || status === 'in_review' || status === 'done') parseHookControl(r.body);
      return setTaskStatusWithHooks(project, num, status as 'todo' | 'in_progress' | 'in_review' | 'done');
    },
    true,
    OWN_TASK,
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
    OWN_TASK,
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
    OWN_TASK,
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
      return trashTaskWithWorktree(project, num);
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
      if (isActiveSandbox(parseSandbox(r.body.sandbox, 'sandbox')) && !SANDBOXABLE_HOOK_TYPES.includes(type)) {
        throw new HttpError(400, `The ${type} hook cannot run in a sandbox`);
      }
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

  // ── Sandbox command (custom backend launcher) ────────────────────
  // The only route family that decides what the next sandboxed spawn executes:
  // a sandbox token must never reach it.
  route('GET', 'sandbox/command', (r) => getCustomSandboxConfig(requireProject(r.query))),

  route('POST', 'sandbox/wrap', (r) => {
    const { argv, cwd, backend } = r.body;
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === 'string')) {
      throw new HttpError(400, 'argv must be a non-empty array of strings');
    }
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new HttpError(400, 'cwd must be an absolute path');
    if (backend !== undefined && !isSandboxBackendId(backend))
      throw new HttpError(400, `Invalid backend: ${String(backend)}`);
    return wrapCommand(
      r.window,
      r.auth.ptyId,
      isSandboxBackendId(backend) ? backend : 'nono',
      argv as string[],
      cwd,
    ).catch((error: unknown) => {
      throw new HttpError(409, error instanceof Error ? error.message : String(error));
    });
  }),

  route('POST', 'sandbox/release', (r) => {
    if (typeof r.body.token !== 'string') throw new HttpError(400, 'Missing token');
    releaseCommand(r.window, r.auth.ptyId, r.body.token);
    return { success: true };
  }),

  route(
    'PUT',
    'sandbox/command',
    async (r) => {
      const project = requireProject(r.query);
      const command = typeof r.body.command === 'string' ? r.body.command.trim() : '';
      if (!command) throw new HttpError(400, 'command is required');
      const result = await setCustomSandboxConfig(project, { command });
      if (!result.success && result.error) throw new HttpError(400, result.error);
      return result;
    },
    true,
  ),

  route('DELETE', 'sandbox/command', (r) => setCustomSandboxConfig(requireProject(r.query), {}), true),

  // ── Terminals ────────────────────────────────────────────────────
  route('GET', 'terminals', () =>
    getActiveSessions()
      .filter((session) => !session.isRunner)
      .map(describeTerminal),
  ),

  route(
    'POST',
    'terminals',
    async (r) => {
      const projectPath = requireProject(r.query);
      const taskNumber = r.body.task === undefined ? undefined : requireInt(String(r.body.task), 'Task number');
      const sandbox = parseSandbox(r.body.sandbox, 'sandbox');
      const { ptyId } = await runTerminalOp({
        action: 'open',
        projectPath,
        taskNumber,
        resume: r.body.resume === true,
        sandbox,
      });
      const session = getActiveSessions().find((s) => s.ptyId === ptyId);
      if (!session) throw new HttpError(404, 'The terminal did not open');
      return describeTerminal(session);
    },
    true,
  ),

  route(
    'DELETE',
    'terminals/:ptyId',
    async (r) => {
      await runTerminalOp({ action: 'close', ptyId: r.segments[1] });
      return { ptyId: r.segments[1], closed: true };
    },
    true,
  ),

  route(
    'GET',
    'terminals/:ptyId/screen',
    async (r) => {
      const { text, alternateScreen } = await runTerminalOp({
        action: 'read',
        ptyId: r.segments[1],
        lines: readLines(r.query),
      });
      return { ptyId: r.segments[1], text: text ?? '', alternateScreen: alternateScreen ?? false };
    },
    false,
    OWN_TERMINAL,
  ),

  route(
    'POST',
    'terminals/:ptyId/paste',
    async (r) => {
      if (typeof r.body.text !== 'string' || !r.body.text) throw new HttpError(400, 'Missing text');
      await runTerminalOp({ action: 'paste', ptyId: r.segments[1], text: r.body.text });
      return { ptyId: r.segments[1], pasted: true };
    },
    true,
  ),

  route('POST', 'terminals/:ptyId/diff', (r) => runTerminalPanelsOp(r.segments[1], 'diff-open'), true),
  route('DELETE', 'terminals/:ptyId/diff', (r) => runTerminalPanelsOp(r.segments[1], 'diff-close'), true),

  // ── Pointers ─────────────────────────────────────────────────────
  // A pointer only suggests where the user might look, and it is the caller's own.
  route(
    'POST',
    'point',
    (r) => {
      const message = typeof r.body.message === 'string' ? r.body.message.trim().slice(0, MAX_POINT_MESSAGE) : '';
      const said = message ? { message } : {};
      if (r.body.kind === 'note') {
        if (typeof r.body.noteId !== 'string' || !r.body.noteId) throw new HttpError(400, 'Missing note id');
        return runPointOp({ fromPtyId: pointingPty(r.auth.ptyId), action: 'note', noteId: r.body.noteId, ...said });
      }
      return runPointOp({ fromPtyId: pointingPty(r.auth.ptyId), action: 'point', target: pointTarget(r), ...said });
    },
    false,
    READ,
  ),

  route('DELETE', 'point', (r) => runPointOp({ fromPtyId: pointingPty(r.auth.ptyId), action: 'clear' }), false, READ),

  // ── Asking the user ──────────────────────────────────────────────
  // Reachable at the lowest CLI access because the caller chooses nothing that
  // runs: the user reads the command and presses Run, or nothing happens.
  route(
    'POST',
    'ask/run',
    async (r) => {
      const ask = await askRun(r);
      const message = typeof r.body.message === 'string' ? r.body.message.trim().slice(0, MAX_POINT_MESSAGE) : '';
      const result = await cliPointRequest({
        fromPtyId: pointingPty(r.auth.ptyId),
        action: 'ask',
        ask,
        ...(message && { message }),
      });
      if (!result.ok) throw new HttpError(404, result.error ?? 'Ask failed');
      return { command: ask.command, cwd: ask.cwd, ...result.answer };
    },
    false,
    READ,
  ),

  // ── Diff notes ───────────────────────────────────────────────────
  route(
    'GET',
    'diff-notes',
    (r) => {
      const ctx = getPtySpawnContext(r.auth.ptyId);
      if (!ctx) throw new HttpError(404, `PTY ${r.auth.ptyId} not found or inactive`);
      return liveNotes(ctx.worktreePath || ctx.projectPath);
    },
    false,
    READ,
  ),

  route('GET', 'tasks/:number/diff-notes', async (r) => {
    const project = requireProject(r.query);
    const num = requireInt(r.segments[1], 'Task number');
    const task = await getTaskWithWorkspace(project, num);
    if (!task) throw new HttpError(404, `Task ${num} not found`);
    if (!task.worktreePath) throw new HttpError(404, `Task ${num} has no worktree`);
    return liveNotes(task.worktreePath);
  }),

  // ── Tags ─────────────────────────────────────────────────────────
  route('GET', 'tags', async () => (await runTagOp({ action: 'list' })).listing ?? []),

  route(
    'GET',
    'terminals/:ptyId/tags',
    (r) => terminalTags({ action: 'get', ptyId: r.segments[1] }),
    false,
    OWN_TERMINAL,
  ),

  route(
    'POST',
    'terminals/:ptyId/tags',
    (r) => {
      const tag = typeof r.body.tag === 'string' ? r.body.tag.trim() : '';
      if (!tag) throw new HttpError(400, 'Missing tag in body');
      return terminalTags({ action: 'add', ptyId: r.segments[1], tag });
    },
    true,
    OWN_TERMINAL,
  ),

  route(
    'DELETE',
    'terminals/:ptyId/tags/:tag',
    (r) => terminalTags({ action: 'remove', ptyId: r.segments[1], tag: decodeURIComponent(r.segments[3]) }),
    true,
    OWN_TERMINAL,
  ),

  route(
    'DELETE',
    'terminals/:ptyId/tags',
    (r) => terminalTags({ action: 'clear', ptyId: r.segments[1] }),
    true,
    OWN_TERMINAL,
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

  // ── Themes (global appearance — not project-scoped) ─────────────
  // Same persistence the renderer theme manager uses (ui:theme /
  // ui:customThemes in global settings); mutations push cli:theme-changed
  // so the renderer re-reads and re-applies live.
  route('GET', 'themes', async () => {
    const stored = await getGlobalSetting(THEME_PREFERENCE_KEY);
    return {
      preference: stored && isThemePreference(stored) ? stored : 'system',
      presets: PRESET_THEMES,
      customThemes: await readCustomThemes(),
    };
  }),

  route(
    'PUT',
    'themes/preference',
    async (r) => {
      const preference = r.body.preference;
      if (typeof preference !== 'string' || !isThemePreference(preference)) {
        throw new HttpError(400, 'Invalid preference: must be system, light, dark, or custom:<id>');
      }
      if (preference.startsWith('custom:')) {
        const merged = withPresets(await readCustomThemes());
        if (!merged.some((t) => `custom:${t.id}` === preference)) {
          throw new HttpError(404, `No theme with id '${preference.slice('custom:'.length)}'`);
        }
      }
      await setGlobalSetting(THEME_PREFERENCE_KEY, preference);
      return { success: true, preference };
    },
    true,
  ),

  route(
    'PUT',
    'themes/custom/:id',
    async (r) => {
      const id = decodeURIComponent(r.segments[2]);
      // The URL segment is authoritative for the id (PUT semantics).
      const theme = parseCustomTheme({ ...r.body, id });
      if (!theme) {
        throw new HttpError(
          400,
          'Invalid theme: needs "name", "base" ("dark" or "light"), and a "tokens" object of --token overrides',
        );
      }
      const list = await readCustomThemes();
      await setGlobalSetting(CUSTOM_THEMES_KEY, JSON.stringify(upsertCustomTheme(list, theme)));
      return { success: true, theme };
    },
    true,
  ),

  route(
    'DELETE',
    'themes/custom/:id',
    async (r) => {
      const id = decodeURIComponent(r.segments[2]);
      const list = await readCustomThemes();
      if (!list.some((t) => t.id === id)) throw new HttpError(404, `No custom theme with id '${id}'`);
      await setGlobalSetting(CUSTOM_THEMES_KEY, JSON.stringify(list.filter((t) => t.id !== id)));
      // Same rule as the renderer's deleteCustomTheme: removing a user copy
      // of a preset restores the preset, so the selection stays valid.
      const preference = await getGlobalSetting(THEME_PREFERENCE_KEY);
      if (selectionOrphanedByDelete(preference, id)) {
        await setGlobalSetting(THEME_PREFERENCE_KEY, 'system');
      }
      return { success: true };
    },
    true,
  ),

  // ── Pull requests ─────────────────────────────────────────────────
  // Reads shell out to `gh` with the user's credentials, which stay in this
  // process: what crosses is pull requests, as Linear's issues do below.
  route(
    'GET',
    'pulls',
    async (r) => {
      const project = requireProject(r.query);
      const availability = await getGithubAvailability(project);
      if (!availability.available) {
        throw new HttpError(400, availability.message ?? 'GitHub is not enabled for this project');
      }
      return getGithubInbox(project);
    },
    false,
    READ,
  ),

  route('GET', 'pulls/:pr', (r) => getGithubPullRequest(requireProject(r.query), prNumber(r)), false, READ),

  route(
    'POST',
    'pulls/:pr/link',
    async (r) => {
      const project = requireProject(r.query);
      const num = prNumber(r);
      const taskNumber = r.body.taskNumber;
      if (typeof taskNumber !== 'number') throw new HttpError(400, 'Missing taskNumber in body');
      const result = await linkGithubTaskToPr(project, taskNumber, num);
      if (!result.success) throw new HttpError(400, result.error ?? 'Failed to link');
      return { success: true, taskNumber, prNumber: num };
    },
    true,
    OWN_TASK,
  ),

  // ── Review drafts ─────────────────────────────────────────────────
  // Local rows that a person sends. A sandboxed caller cannot name itself: the
  // origin is stamped here, so a draft's provenance cannot be forged by the
  // thing that wrote it.
  route('GET', 'pulls/:pr/drafts', (r) => listDrafts(requireProject(r.query), prNumber(r)), false, READ),

  route(
    'POST',
    'pulls/:pr/drafts',
    async (r) => {
      const project = requireProject(r.query);
      if (typeof r.body.id === 'string') guardSandboxDraft(r, await getReviewDraft(r.body.id));
      const draft = await saveDraft(project, {
        ...draftInput(r.body),
        prNumber: prNumber(r),
        origin: r.auth.scope === 'sandbox' ? 'sandbox' : ((r.body.origin as string | undefined) ?? 'cli'),
      });
      return draft;
    },
    true,
    READ,
  ),

  route(
    'DELETE',
    'pulls/:pr/drafts/:id',
    async (r) => {
      const id = r.segments[3];
      if (!id) throw new HttpError(400, 'Missing draft id');
      const project = requireProject(r.query);
      guardSandboxDraft(r, await getReviewDraft(id));
      const result = await discardDraft(project, id, prNumber(r));
      if (!result.success) throw new HttpError(404, `No draft ${id} on pull request ${prNumber(r)}`);
      return result;
    },
    true,
    READ,
  ),

  // ── Lens ─────────────────────────────────────────────────────
  route(
    'GET',
    'pulls/:pr/lens',
    async (r) => {
      const project = requireProject(r.query);
      const headSha = r.query.get('headSha');
      if (!headSha) throw new HttpError(400, 'Missing ?headSha=');
      return getPullRequestLens(project, prNumber(r), headSha);
    },
    false,
    READ,
  ),

  route(
    'PUT',
    'pulls/:pr/lens',
    async (r) => {
      const project = requireProject(r.query);
      const headSha = r.body.headSha;
      const groups = r.body.groups;
      if (typeof headSha !== 'string' || !headSha) throw new HttpError(400, 'Missing headSha');
      const result = await setPullRequestLens(project, prNumber(r), headSha, { groups });
      if (!result.success) throw new HttpError(400, result.error ?? 'Invalid lens');
      return result;
    },
    true,
    READ,
  ),

  route(
    'DELETE',
    'pulls/:pr/lens',
    async (r) => clearPullRequestLens(requireProject(r.query), prNumber(r)),
    true,
    READ,
  ),

  // ── Linear ────────────────────────────────────────────────────────
  // Reads are sandbox-reachable and the key never crosses: the main process
  // holds it, and what comes back is issues. Writes to Linear itself are not
  // here at all — an agent stages a comment and a person sends it.
  route('GET', 'linear/issues', (r) => getLinearIssues(requireProject(r.query)), false, READ),

  route('GET', 'linear/issues/:id', (r) => getLinearIssue(requireProject(r.query), issueId(r)), false, READ),

  route(
    'POST',
    'linear/issues/:id/link',
    async (r) => {
      const project = requireProject(r.query);
      const taskNumber = r.body.taskNumber;
      if (typeof taskNumber !== 'number') throw new HttpError(400, 'Missing taskNumber in body');
      const result = await linkTaskToLinearIssue(project, taskNumber, issueId(r));
      if (!result.success) throw new HttpError(400, result.error ?? 'Failed to link');
      return { success: true, taskNumber, issue: issueId(r) };
    },
    true,
    OWN_TASK,
  ),

  // Drafts, on the same terms the pull request ones take: local rows with an
  // origin stamped here, so a sandboxed caller cannot forge one.
  route(
    'GET',
    'linear/issues/:id/drafts',
    async (r) => {
      const project = requireProject(r.query);
      return listLinearDrafts(project, await resolveLinearIssueId(project, issueId(r)));
    },
    false,
    READ,
  ),

  route(
    'POST',
    'linear/issues/:id/drafts',
    async (r) => {
      const project = requireProject(r.query);
      const body = r.body.body;
      if (typeof body !== 'string' || !body.trim()) throw new HttpError(400, 'Missing body');
      return saveLinearDraft(
        project,
        await resolveLinearIssueId(project, issueId(r)),
        body,
        r.auth.scope === 'sandbox' ? 'sandbox' : ((r.body.origin as string | undefined) ?? 'cli'),
      );
    },
    true,
    READ,
  ),

  route(
    'DELETE',
    'linear/issues/:id/drafts/:draftId',
    async (r) => {
      const draftId = r.segments[4];
      if (!draftId) throw new HttpError(400, 'Missing draft id');
      const project = requireProject(r.query);
      guardSandboxDraft(r, await findLinearDraft(project, draftId));
      return discardLinearDraft(project, draftId);
    },
    true,
    READ,
  ),

  // ── Panels ────────────────────────────────────────────────────────
  // A sandbox may list its own terminal's panels and read them, and attach
  // markdown from its worktree. Previews and runners stay the host's: one loads
  // any URL in this window, the other runs a script on the host.
  route('GET', 'panels/:ptyId', (r) => runTerminalPanelsOp(r.segments[1], 'list-all'), false, OWN_TERMINAL),

  // Matched before the panel-kind routes, whose `:kind` would otherwise read `focus`.
  route(
    'POST',
    'panels/:ptyId/focus',
    (r) => {
      if (typeof r.body.id !== 'string' || !r.body.id) throw new HttpError(400, 'Missing id');
      return runTerminalPanelsOp(r.segments[1], 'focus', r.body.id);
    },
    true,
  ),

  route(
    'GET',
    'panels/:ptyId/:kind',
    (r) => runPanelOp(r.segments[1], 'list', parsePanelKind(r.segments[2])),
    false,
    OWN_TERMINAL,
  ),

  route(
    'GET',
    'panels/:ptyId/:id/screen',
    async (r) => {
      const result = await cliPanelRequest({
        ptyId: r.segments[1],
        action: 'read',
        value: r.segments[2],
        lines: readLines(r.query),
      });
      if (!result.ok) throw new HttpError(404, result.error ?? 'Panel read failed');
      return { ptyId: r.segments[1], id: r.segments[2], ...result.read };
    },
    false,
    OWN_TERMINAL,
  ),

  route(
    'POST',
    'panels/:ptyId/:kind',
    (r) => {
      const kind = sandboxPanelKind(r, parsePanelKind(r.segments[2]));
      const value = panelValue(kind, r.body.path, r.body.url, r.body.script);
      if (r.auth.scope === 'sandbox' && worktreeRelative(r.auth.ptyId, value) === null) {
        throw new HttpError(403, 'A sandboxed terminal attaches markdown from its own worktree');
      }
      return runPanelOp(r.segments[1], 'add', kind, value);
    },
    true,
    OWN_TERMINAL,
  ),

  route(
    'DELETE',
    'panels/:ptyId/:kind',
    (r) => {
      const kind = sandboxPanelKind(r, parsePanelKind(r.segments[2]));
      // DELETE carries no body through the CLI client; the target comes in the
      // query string (?path= / ?url= / ?script=).
      const value = panelValue(
        kind,
        r.query.get('path') ?? undefined,
        r.query.get('url') ?? undefined,
        r.query.get('script') ?? undefined,
      );
      return runPanelOp(r.segments[1], 'remove', kind, value);
    },
    true,
    OWN_TERMINAL,
  ),
];

// ── Sandbox CLI access ───────────────────────────────────────────────

interface SandboxCaller extends AuthContext {
  access: SandboxCliAccess;
}

/**
 * A sandboxed terminal's access comes from its project's setting. At
 * "Everything" it is treated as a host caller throughout, handlers included.
 */
async function withCliAccess(auth: AuthContext): Promise<SandboxCaller> {
  if (auth.scope === 'host') return { ...auth, access: 'all' };
  const context = getPtyTaskContext(auth.ptyId);
  const stored = context ? await getGlobalSetting(sandboxCliAccessSettingKey(context.projectPath)) : undefined;
  const access = isSandboxCliAccess(stored) ? stored : 'read';
  return access === 'all' ? { ...auth, scope: 'host', access } : { ...auth, access };
}

function sandboxAllows(
  rule: SandboxRule | undefined,
  caller: SandboxCaller,
  params: Record<string, string>,
  query: URLSearchParams,
  body: Record<string, unknown>,
): boolean {
  if (!rule || (rule.level === 'task' && caller.access !== 'task')) return false;
  const project = query.get('project');
  if (project !== null && project !== getPtySpawnContext(caller.ptyId)?.projectPath) return false;
  if (rule.owns === 'terminal') return ownsTerminal(caller, params.ptyId);
  if (rule.owns === 'task') return ownsTask(caller, query.get('project'), params.number ?? body.taskNumber);
  return true;
}

function ownsTerminal(caller: SandboxCaller, ptyId: string | undefined): boolean {
  if (!ptyId) return false;
  if (ptyId === caller.ptyId) return true;
  if (caller.access !== 'task') return false;
  const own = getPtyTaskContext(caller.ptyId);
  const theirs = getPtyTaskContext(ptyId);
  return (
    !!own &&
    !!theirs &&
    own.projectPath === theirs.projectPath &&
    own.taskId === theirs.taskId &&
    isActiveSandbox(getPtySpawnContext(ptyId)?.sandboxProvider)
  );
}

function ownsTask(caller: SandboxCaller, project: string | null, taskNumber: unknown): boolean {
  const own = getPtyTaskContext(caller.ptyId);
  return !!own && own.projectPath === project && String(own.taskId) === String(taskNumber);
}

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

  // Every route requires a valid per-PTY bearer token. Sandboxed shells run
  // on the host, so loopback reachability is not a security boundary.
  const auth = authenticateRequest(req.headers['authorization']);
  if (!auth) {
    json(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Capture-only routes: gated on OUIJIT_CAPTURE_MODE at runtime so they
  // simply don't exist in production builds. Auth is already required
  // (driver uses OUIJIT_CAPTURE_TOKEN registered via registerStaticToken).
  if (isCaptureMode() && method === 'POST' && segments[0] === 'capture') {
    let body: Record<string, unknown> = {};
    try {
      const raw = await readBody(req);
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    try {
      let result: unknown;
      if (segments[1] === 'navigate') {
        result = await handleCaptureNavigate({ window, body });
      } else if (segments[1] === 'snapshot') {
        result = await handleCaptureSnapshot({ window, body });
      } else {
        json(res, 404, { error: `No capture route /api/capture/${segments[1] ?? ''}` });
        return;
      }
      json(res, 200, { data: result });
    } catch (err) {
      json(res, 400, { error: err instanceof Error ? err.message : 'Capture error' });
    }
    return;
  }

  const matched = matchRoute(routes, method, segments);
  if (!matched) {
    json(res, 404, { error: `No route for ${method} /api/${apiPath}` });
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

  const caller = await withCliAccess(auth);
  if (
    caller.scope !== 'host' &&
    !sandboxAllows(matched.route.sandbox, caller, matched.params, url.searchParams, body)
  ) {
    json(res, 403, { error: 'Forbidden' });
    return;
  }

  // A status PATCH to in_progress/in_review/done fires a renderer-side hook,
  // which needs the *old* status to disambiguate start vs continue and to skip
  // a no-op (status unchanged — e.g. re-running set-status on a task already in
  // that column would otherwise re-spawn the hook / re-show the dialog).
  // Capture it before the handler overwrites it.
  let prevStatus: string | undefined;
  if (
    isStatusPatchRoute(method, segments) &&
    (body.status === 'in_progress' || body.status === 'in_review' || body.status === 'done')
  ) {
    const num = parseInt(segments[1] ?? '', 10);
    if (!Number.isNaN(num)) {
      const existing = await getTaskByNumber(url.searchParams.get('project') ?? '', num);
      prevStatus = existing?.status;
    }
  }

  try {
    const result = await matched.route.handler({
      method,
      segments,
      query: url.searchParams,
      body,
      auth: caller,
      window,
    });
    json(res, 200, { data: result });

    // Notify renderer after mutating operations
    if (matched.route.mutating && window && !window.isDestroyed()) {
      const project = url.searchParams.get('project') ?? '';
      typedPush(window, 'cli-change', {
        project,
        action: `${method} /api/${apiPath}`,
        resource: segments[0] ?? '',
        ts: Date.now(),
      });

      // Theme mutations: the renderer theme manager holds module state, so
      // tell it to re-read global settings and re-apply.
      if (segments[0] === 'themes') {
        typedPush(window, 'cli:theme-changed');
      }

      // A draft written here belongs to a pull request the renderer may have
      // open, and it happened in another process, so there is nothing for the
      // renderer to have noticed. This is the only GitHub push there is: it
      // names the one pull request that moved, and its handler does a single
      // local read. It must never grow into "something changed, refetch".
      if (segments[0] === 'pulls' && segments[2] === 'drafts') {
        typedPush(window, 'github:drafts-changed', {
          projectPath: project,
          prNumber: parseInt(segments[1], 10),
        });
      }

      // The same push, for a comment staged against a Linear issue. The id
      // comes from the result rather than the path, which carries whatever the
      // caller had — usually the identifier, which is not what drafts are keyed
      // by.
      if (segments[0] === 'linear' && segments[3] === 'drafts') {
        const issueId = (result as { issueId?: string } | null)?.issueId;
        if (issueId) typedPush(window, 'linear:drafts-changed', { projectPath: project, issueId });
      }

      // Task-start routes also need a terminal + hook in the renderer.
      // The HTTP handler only creates the worktree + DB row; the renderer
      // owns terminal/hook lifecycle, so signal it explicitly here.
      if (isTaskStartRoute(method, segments) && isSuccessfulStart(result)) {
        const startResult = result as TaskStartResult;
        const task = startResult.task;
        if (task && startResult.worktreePath && task.branch) {
          const hookControl = parseHookControl(body);
          typedPush(window, 'cli:task-started', {
            project,
            taskNumber: task.taskNumber,
            worktreePath: startResult.worktreePath,
            branch: task.branch,
            createdAt: task.createdAt,
            ...hookControl,
            ...cliCaller(caller, body),
          });
        }
      }

      // CLI set-status N done: the server wrote the status, but the renderer
      // owns the rest of the done lifecycle (terminal cleanup + done-hook
      // spawn). The task is fetched here and included in the payload so the
      // renderer doesn't need projectStore.tasks (which only holds the active
      // project's task list — would miss when the user is viewing elsewhere).
      if (
        isStatusPatchRoute(method, segments) &&
        body.status === 'done' &&
        isSuccessfulMutation(result) &&
        prevStatus !== 'done'
      ) {
        const taskNumber = parseInt(segments[1] ?? '', 10);
        if (!Number.isNaN(taskNumber)) {
          const task = await getTaskWithWorkspace(project, taskNumber);
          if (task) {
            const hookControl = parseHookControl(body);
            typedPush(window, 'cli:task-completed', {
              project,
              taskNumber,
              task,
              ...hookControl,
              ...cliCaller(caller, body),
            });
          }
        }
      }

      // CLI set-status N in_progress|in_review: the server wrote the status, but
      // the in_progress/in_review hook lives in the renderer (beginTransition).
      // Push the transition with the *old* status so the renderer runs the same
      // path a kanban drop would — dialog by default, headless when the CLI
      // passed --run-hook/--skip-hook/--hook-command. Skipped when the status
      // didn't actually change (no transition, no hook).
      if (
        isStatusPatchRoute(method, segments) &&
        (body.status === 'in_progress' || body.status === 'in_review') &&
        isSuccessfulMutation(result) &&
        prevStatus &&
        prevStatus !== body.status
      ) {
        const taskNumber = parseInt(segments[1] ?? '', 10);
        if (!Number.isNaN(taskNumber)) {
          const task = await getTaskWithWorkspace(project, taskNumber);
          if (task) {
            const hookControl = parseHookControl(body);
            typedPush(window, 'cli:task-transitioned', {
              project,
              taskNumber,
              origStatus: prevStatus as 'todo' | 'in_progress' | 'in_review' | 'done',
              newStatus: body.status,
              task,
              ...hookControl,
              ...cliCaller(caller, body),
            });
          }
        }
      }
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
