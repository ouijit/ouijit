/**
 * Automations, in the main process: the schedule, the runs, and what a run
 * leaves behind. A run is a hidden PTY, so it keeps going with no window open.
 */

import { automations as repo, createTask, ensureProject, getHooks, getNextTaskNumber, getTaskByNumber } from '../db';
import { getLogger } from '../logger';
import { getSandboxProvider } from '../sandbox';
import { isActiveSandbox, isSandboxProviderId } from '../sandbox/types';
import { killPty, onPtyData, onPtyExit, readPtyOutput, revealPty, spawnPty } from '../ptyManager';
import { onHookStatus } from '../hookServer';
import { createRunWorktree, removeRunWorktree, sanitizeBranchName } from '../worktree';
import { parseOsc133ExitCodes } from '../components/terminal/osc133';
import { lastRun, nextRun, validateSchedule } from './schedule';
import { lastScreen } from './lastScreen';
import type {
  Automation,
  AutomationInput,
  AutomationRun,
  AutomationsSnapshot,
  RunOpening,
  RunState,
  RunTrigger,
} from './types';

const log = getLogger().scope('automations');

const TICK_MS = 30_000;
/** Later than this past its time, a run counts as missed rather than due. */
const LATE_MS = 2 * 60_000;
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60_000;
const MAX_RUN_MS = 2 * 60 * 60_000;
export const MAX_CONCURRENT_RUNS = 2;

export interface AutomationHost {
  /** Something about a project's automations changed. */
  changed(projectPath: string): void;
  notify(title: string, body: string, projectPath: string): void;
}

let host: AutomationHost = { changed: () => {}, notify: () => {} };

interface LiveRun {
  runId: string;
  ptyId: string;
  kind: Automation['kind'];
  /** Watched since Run now; its terminal stays open when the run ends. */
  revealed: boolean;
  timer: ReturnType<typeof setTimeout>;
}

const live = new Map<string, LiveRun>();
const runByPty = new Map<string, string>();
const queue: string[] = [];
const unsubscribers: (() => void)[] = [];
let ticker: ReturnType<typeof setInterval> | null = null;

// ── Lifecycle ────────────────────────────────────────────────────────

export function startAutomations(h: AutomationHost): void {
  host = h;
  failInterruptedRuns();
  unsubscribers.push(
    onPtyData(onData),
    onPtyExit((ptyId, exitCode) => {
      const runId = runByPty.get(ptyId);
      if (runId) void finish(runId, exitCode === 0 ? 'quiet' : 'failed', { exitCode, exited: true });
    }),
    onHookStatus((ptyId, entry) => {
      const runId = runByPty.get(ptyId);
      if (!runId || live.get(runId)?.kind !== 'agent') return;
      if (entry.status === 'ready' && entry.thinkingCount > 0) void finish(runId, 'quiet');
    }),
  );
  void tick();
  ticker = setInterval(() => void tick(), TICK_MS);
}

export function stopAutomations(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
  for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
  for (const run of live.values()) clearTimeout(run.timer);
  live.clear();
  runByPty.clear();
  queue.length = 0;
}

/** A run still marked going was cut off when Ouijit last quit. */
function failInterruptedRuns(): void {
  for (const run of repo().runsInState(['running', 'queued'])) {
    repo().updateRun(run.id, {
      state: run.state === 'queued' ? 'skipped' : 'failed',
      reason: 'Ouijit quit before it finished',
      endedAt: new Date().toISOString(),
      unread: run.state === 'running',
    });
  }
}

// ── Schedule ─────────────────────────────────────────────────────────

/** Fires what is due and catches up what was missed. Runs every 30 seconds and on wake. */
export async function tick(now = new Date()): Promise<void> {
  for (const automation of repo().list()) {
    if (automation.paused || !automation.schedule || !automation.nextRunAt) continue;
    const due = new Date(automation.nextRunAt);
    if (now < due) continue;
    repo().setNextRunAt(automation.id, nextRun(automation.schedule, now)?.toISOString() ?? null);
    if (now.getTime() - due.getTime() <= LATE_MS) {
      await fire(automation, 'schedule', due);
      continue;
    }
    const since = new Date(Math.max(due.getTime(), now.getTime() - CATCH_UP_WINDOW_MS));
    const missed = lastRun(automation.schedule, now, since);
    if (!missed) continue;
    if (automation.missed === 'skip') {
      repo().addRun(automation, {
        state: 'skipped',
        trigger: 'schedule',
        scheduledFor: missed.toISOString(),
        reason: 'Missed while Ouijit was closed or the Mac was asleep',
      });
      host.changed(automation.projectPath);
      continue;
    }
    host.notify(automation.name, 'Catching up on a missed run', automation.projectPath);
    await fire(automation, 'catch-up', missed);
  }
}

async function fire(automation: Automation, trigger: RunTrigger, scheduledFor?: Date): Promise<AutomationRun> {
  const going = repo()
    .runsInState(['running', 'queued'])
    .some((r) => r.automationId === automation.id);
  if (going) {
    const skipped = repo().addRun(automation, {
      state: 'skipped',
      trigger,
      scheduledFor: scheduledFor?.toISOString(),
      reason: 'The previous run was still going',
    });
    host.changed(automation.projectPath);
    return skipped;
  }
  const run = repo().addRun(automation, { state: 'queued', trigger, scheduledFor: scheduledFor?.toISOString() });
  queue.push(run.id);
  host.changed(automation.projectPath);
  await pump();
  return repo().getRun(run.id) ?? run;
}

async function pump(): Promise<void> {
  while (live.size < MAX_CONCURRENT_RUNS && queue.length > 0) {
    await start(queue.shift()!);
  }
}

// ── Runs ─────────────────────────────────────────────────────────────

function branchStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function agentPrompt(automation: Automation): string {
  return [
    automation.prompt ?? '',
    '',
    `This is an unattended run of the Ouijit automation "${automation.name}". Nobody is watching it.`,
    'If something needs the user, run `ouijit automation notify "<one line>"` before you finish. Otherwise just finish.',
  ].join('\n');
}

function runEnv(automation: Automation, run: AutomationRun): Record<string, string> {
  return {
    OUIJIT_AUTOMATION_NAME: automation.name,
    OUIJIT_RUN_ID: run.id,
    OUIJIT_PROJECT_PATH: automation.projectPath,
    OUIJIT_TASK_NAME: automation.name,
    ...(run.worktreePath && { OUIJIT_WORKTREE_PATH: run.worktreePath }),
    ...(run.branch && { OUIJIT_TASK_BRANCH: run.branch }),
  };
}

async function start(runId: string): Promise<void> {
  const queued = repo().getRun(runId);
  const automation = queued && repo().get(queued.automationId);
  if (!queued || !automation) return;
  const startedAt = new Date();
  let run = repo().updateRun(runId, { state: 'running', startedAt: startedAt.toISOString() })!;
  host.changed(automation.projectPath);

  try {
    let command: string;
    const env: Record<string, string> = {};
    if (automation.kind === 'agent') {
      const startHook = (await getHooks(automation.projectPath)).start;
      if (!startHook) throw new Error('This project has no start hook to run an agent with');
      command = startHook.command;
      env.OUIJIT_HOOK_TYPE = 'start';
      env.OUIJIT_TASK_DESCRIPTION = agentPrompt(automation);
      env.OUIJIT_TASK_PROMPT = env.OUIJIT_TASK_DESCRIPTION;
    } else {
      command = automation.command ?? '';
      if (!command.trim()) throw new Error('Nothing to run');
    }

    let cwd = automation.projectPath;
    if (automation.location === 'worktree') {
      const slug = sanitizeBranchName(automation.name) || 'run';
      const worktree = await createRunWorktree(
        automation.projectPath,
        `A-${runId.slice(0, 8)}`,
        `automation/${slug}-${branchStamp(startedAt)}-${runId.slice(0, 4)}`,
      );
      cwd = worktree.worktreePath;
      run = repo().updateRun(runId, {
        worktreePath: worktree.worktreePath,
        branch: worktree.branch,
        baseCommit: worktree.baseCommit,
        mergeTarget: worktree.mergeTarget,
      })!;
    }

    const sandbox = isActiveSandbox(automation.sandbox) ? automation.sandbox : undefined;
    const result = await spawnPty(
      {
        cwd,
        projectPath: automation.projectPath,
        command,
        label: automation.name,
        worktreePath: run.worktreePath,
        sandboxProvider: sandbox,
        hidden: true,
        cols: 120,
        rows: 36,
        env: { ...runEnv(automation, run), ...env },
      },
      null,
      sandbox ? getSandboxProvider(sandbox) : undefined,
    );
    if (!result.success || !result.ptyId) throw new Error(result.error ?? 'The run could not start');

    const ptyId = result.ptyId;
    runByPty.set(ptyId, runId);
    live.set(runId, {
      runId,
      ptyId,
      kind: automation.kind,
      revealed: false,
      timer: setTimeout(() => void finish(runId, 'failed', { reason: 'Stopped after 2 hours' }), MAX_RUN_MS),
    });
    log.info('run started', { automation: automation.name, runId, ptyId });
    host.changed(automation.projectPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn('run failed to start', { automation: automation.name, runId, reason });
    await finish(runId, 'failed', { reason });
  }
}

function onData(ptyId: string, data: string): void {
  const runId = runByPty.get(ptyId);
  if (!runId || live.get(runId)?.kind !== 'command') return;
  // The startup command's own OSC 133;D is the first one a fresh shell prints.
  const [exitCode] = parseOsc133ExitCodes(data);
  if (exitCode !== undefined) void finish(runId, exitCode === 0 ? 'quiet' : 'failed', { exitCode });
}

async function finish(
  runId: string,
  outcome: 'quiet' | 'failed',
  detail: { exitCode?: number; reason?: string; exited?: boolean } = {},
): Promise<void> {
  const liveRun = live.get(runId);
  const run = repo().getRun(runId);
  if (!run || (run.state !== 'running' && run.state !== 'queued')) return;
  const automation = repo().get(run.automationId);

  let output: string | undefined;
  if (liveRun) {
    clearTimeout(liveRun.timer);
    live.delete(runId);
    runByPty.delete(liveRun.ptyId);
    const raw = readPtyOutput(liveRun.ptyId);
    if (raw) output = lastScreen(raw);
    if (!liveRun.revealed && !detail.exited) killPty(liveRun.ptyId);
  }

  const state: RunState = outcome === 'failed' ? 'failed' : run.summary ? 'needs-you' : 'quiet';
  const watched = liveRun?.revealed ?? false;
  const keepWorktree = state !== 'quiet' || watched;
  if (!keepWorktree && run.worktreePath) {
    await removeRunWorktree(run.projectPath, run.worktreePath, run.branch, run.baseCommit);
  }
  repo().updateRun(runId, {
    state,
    endedAt: new Date().toISOString(),
    ...(detail.exitCode !== undefined && { exitCode: detail.exitCode }),
    ...(detail.reason && { reason: detail.reason }),
    ...(output !== undefined && { output }),
    ...(!keepWorktree && { worktreePath: undefined }),
    unread: state !== 'quiet' && !watched,
  });
  log.info('run ended', { runId, state });

  if (automation && state !== 'quiet' && !watched) {
    host.notify(
      automation.name,
      state === 'failed' ? (detail.reason ?? 'The run failed') : (run.summary ?? 'Needs you'),
      automation.projectPath,
    );
  }
  host.changed(run.projectPath);
  await pump();
}

// ── Reading and managing ─────────────────────────────────────────────

function withLive(run: AutomationRun): AutomationRun {
  const liveRun = live.get(run.id);
  return liveRun ? { ...run, ptyId: liveRun.ptyId } : run;
}

export function automationsSnapshot(projectPath?: string): AutomationsSnapshot {
  return { automations: repo().list(projectPath), runs: repo().runs(projectPath).map(withLive) };
}

/** By id, or by name within a project. */
export function findAutomation(projectPath: string | undefined, idOrName: string): Automation {
  const found = repo().get(idOrName) ?? (projectPath ? repo().findByName(projectPath, idOrName) : undefined);
  if (!found || (projectPath && found.projectPath !== projectPath)) {
    throw new Error(`No automation named ${idOrName}`);
  }
  return found;
}

function cleanInput(projectPath: string, input: AutomationInput, id?: string): AutomationInput {
  const name = input.name?.trim();
  if (!name) throw new Error('An automation needs a name');
  const clash = repo().findByName(projectPath, name);
  if (clash && clash.id !== id) throw new Error(`There is already an automation named ${name}`);
  if (input.kind !== 'agent' && input.kind !== 'command') throw new Error('Run an agent or a command');
  const prompt = input.prompt?.trim();
  const command = input.command?.trim();
  if (input.kind === 'agent' && !prompt) throw new Error('An agent automation needs a prompt');
  if (input.kind === 'command' && !command) throw new Error('A command automation needs a command');
  if (input.schedule !== null) validateSchedule(input.schedule);
  if (input.missed !== 'run-once' && input.missed !== 'skip') throw new Error('Missed runs: run-once or skip');
  if (input.location !== 'worktree' && input.location !== 'project') throw new Error('Run in worktree or project');
  if (!isSandboxProviderId(input.sandbox)) throw new Error(`Unknown sandbox ${String(input.sandbox)}`);
  return {
    name,
    kind: input.kind,
    ...(input.kind === 'agent' ? { prompt } : { command }),
    schedule: input.schedule,
    missed: input.missed,
    location: input.location,
    sandbox: input.sandbox,
  };
}

function nextRunFor(schedule: string | null, paused: boolean): string | null {
  return schedule && !paused ? (nextRun(schedule, new Date())?.toISOString() ?? null) : null;
}

export function createAutomation(projectPath: string, input: AutomationInput): Automation {
  ensureProject(projectPath);
  const clean = cleanInput(projectPath, input);
  const created = repo().create(projectPath, clean, nextRunFor(clean.schedule, false));
  host.changed(projectPath);
  return created;
}

export function updateAutomation(id: string, input: AutomationInput): Automation {
  const existing = repo().get(id);
  if (!existing) throw new Error('No such automation');
  const clean = cleanInput(existing.projectPath, input, id);
  const updated = repo().update(id, clean, nextRunFor(clean.schedule, existing.paused))!;
  host.changed(existing.projectPath);
  return updated;
}

export function setAutomationPaused(id: string, paused: boolean): Automation {
  const existing = repo().get(id);
  if (!existing) throw new Error('No such automation');
  repo().setPaused(id, paused, nextRunFor(existing.schedule, paused));
  host.changed(existing.projectPath);
  return repo().get(id)!;
}

export async function deleteAutomation(id: string): Promise<void> {
  const existing = repo().get(id);
  if (!existing) return;
  for (const run of repo().runs(existing.projectPath)) {
    if (run.automationId !== id) continue;
    const liveRun = live.get(run.id);
    if (liveRun) {
      clearTimeout(liveRun.timer);
      live.delete(run.id);
      runByPty.delete(liveRun.ptyId);
      killPty(liveRun.ptyId);
    }
    if (run.worktreePath && run.taskNumber === undefined) {
      await removeRunWorktree(run.projectPath, run.worktreePath, run.branch, run.baseCommit);
    }
  }
  const queuedHere = new Set(
    repo()
      .runs(existing.projectPath)
      .map((r) => r.id),
  );
  for (let i = queue.length - 1; i >= 0; i--) if (queuedHere.has(queue[i])) queue.splice(i, 1);
  repo().delete(id);
  host.changed(existing.projectPath);
  await pump();
}

export function runAutomationNow(id: string): Promise<AutomationRun> {
  const automation = repo().get(id);
  if (!automation) throw new Error('No such automation');
  return fire(automation, 'manual').then(withLive);
}

/** From `ouijit automation notify`, inside a run. */
export function notifyFromRun(ptyId: string, summary: string): AutomationRun {
  const runId = runByPty.get(ptyId);
  if (!runId) throw new Error('Not inside an automation run');
  const run = repo().updateRun(runId, { summary: summary.trim().slice(0, 200) })!;
  host.changed(run.projectPath);
  return run;
}

/** What opening a run shows, and the run read from then on. */
export async function openRun(runId: string): Promise<RunOpening> {
  const run = repo().getRun(runId);
  if (!run) throw new Error('No such run');
  repo().updateRun(runId, { unread: false });
  host.changed(run.projectPath);

  const liveRun = live.get(runId);
  if (liveRun) {
    liveRun.revealed = true;
    const session = revealPty(liveRun.ptyId);
    if (session) return { kind: 'live', session };
  }

  const automation = repo().get(run.automationId);
  if (automation?.kind === 'agent' && run.worktreePath && run.taskNumber === undefined) {
    const hooks = await getHooks(run.projectPath);
    const prompt = agentPrompt(automation);
    return {
      kind: 'continue',
      worktreePath: run.worktreePath,
      ...(run.branch && { branch: run.branch }),
      command: hooks.continue?.command ?? '',
      sandbox: automation.sandbox,
      env: {
        ...runEnv(automation, run),
        OUIJIT_HOOK_TYPE: 'continue',
        OUIJIT_TASK_DESCRIPTION: prompt,
        OUIJIT_TASK_PROMPT: prompt,
      },
    };
  }
  if (run.taskNumber !== undefined) return { kind: 'task', taskNumber: run.taskNumber };
  return { kind: 'output' };
}

export async function dismissRun(runId: string): Promise<void> {
  const run = repo().getRun(runId);
  if (!run || run.state === 'running' || run.state === 'queued') return;
  if (run.worktreePath && run.taskNumber === undefined) {
    await removeRunWorktree(run.projectPath, run.worktreePath, run.branch, run.baseCommit);
  }
  repo().updateRun(runId, {
    unread: false,
    ...(run.taskNumber === undefined && { worktreePath: undefined }),
  });
  host.changed(run.projectPath);
}

/** Puts a run on the board as an in-progress task that keeps its worktree and branch. */
export async function makeTaskFromRun(runId: string): Promise<number> {
  const run = repo().getRun(runId);
  if (!run) throw new Error('No such run');
  if (run.taskNumber !== undefined && (await getTaskByNumber(run.projectPath, run.taskNumber))) {
    return run.taskNumber;
  }
  if (run.state === 'running' || run.state === 'queued') throw new Error('The run is still going');
  if (!run.worktreePath || !run.branch) throw new Error('Only a run that worked in a worktree can become a task');
  const automation = repo().get(run.automationId);
  const taskNumber = await getNextTaskNumber(run.projectPath);
  const day = new Date(run.startedAt ?? Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  await createTask(run.projectPath, taskNumber, `${automation?.name ?? 'Automation'} · ${day}`, {
    status: 'in_progress',
    branch: run.branch,
    worktreePath: run.worktreePath,
    ...(run.mergeTarget && { mergeTarget: run.mergeTarget }),
    prompt: run.summary ?? automation?.prompt ?? automation?.command,
  });
  repo().updateRun(runId, { taskNumber, unread: false });
  host.changed(run.projectPath);
  return taskNumber;
}
