import { useEffect } from 'react';
import { create } from 'zustand';
import type {
  HookType,
  ProjectHooks,
  SandboxBackendId,
  SandboxCliAccess,
  SandboxProviderId,
  SandboxProviderStatus,
  Script,
  ScriptHook,
  TaskStatus,
  TaskWithWorkspace,
} from '../types';
import {
  isSandboxCliAccess,
  isSandboxProviderId,
  defaultSandboxSettingKey,
  sandboxCliAccessSettingKey,
} from '../types';
import { useAppStore } from './appStore';
import { useProjectStore } from './projectStore';

export interface ProjectConfig {
  sandboxStatuses: SandboxProviderStatus[];
  /** The backends in `sandboxStatuses` that can run. */
  availableSandboxProviders: SandboxBackendId[];
  hooks: ProjectHooks;
  /** Where task terminals that run no hook, and Run and scripts from a terminal's + menu, run unless told otherwise. */
  defaultSandbox: SandboxProviderId;
  sandboxCliAccess: SandboxCliAccess;
}

interface ProjectDataState {
  configByProject: Record<string, ProjectConfig>;
  scriptsByProject: Record<string, Script[]>;
}

export const useProjectDataStore = create<ProjectDataState>()(() => ({
  configByProject: {},
  scriptsByProject: {},
}));

export function availableBackends(statuses: SandboxProviderStatus[]): SandboxBackendId[] {
  return statuses.filter((s) => s.available).map((s) => s.providerId);
}

const EMPTY_TASKS: TaskWithWorkspace[] = [];

function latestOnly() {
  const versions = new Map<string, number>();
  return {
    begin: (projectPath: string) => {
      const version = (versions.get(projectPath) ?? 0) + 1;
      versions.set(projectPath, version);
      return () => versions.get(projectPath) === version;
    },
  };
}

const taskLoads = latestOnly();
const configLoads = latestOnly();
const scriptLoads = latestOnly();
const inFlight = new Set<string>();

function setTasks(projectPath: string, tasks: TaskWithWorkspace[]): void {
  useAppStore.getState().updateProjectTaskCache(projectPath, tasks);
  if (useAppStore.getState().activeProjectPath === projectPath) useProjectStore.getState().pruneSelection(tasks);
}

export async function loadTasks(projectPath: string): Promise<void> {
  const isLatest = taskLoads.begin(projectPath);
  try {
    const tasks = await window.api.task.getAll(projectPath);
    if (isLatest()) setTasks(projectPath, tasks);
  } catch (err) {
    if (!isLatest()) return;
    useProjectStore
      .getState()
      .addToast(`Failed to load tasks: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

export async function loadProjectConfig(projectPath: string): Promise<void> {
  const isLatest = configLoads.begin(projectPath);
  try {
    const [statuses, hooks, defaultSandbox, sandboxCliAccess] = await Promise.all([
      window.api.sandbox.status(projectPath),
      window.api.hooks.get(projectPath),
      window.api.globalSettings.get(defaultSandboxSettingKey(projectPath)),
      window.api.globalSettings.get(sandboxCliAccessSettingKey(projectPath)),
    ]);
    if (!isLatest()) return;
    setConfig(projectPath, {
      sandboxStatuses: statuses,
      availableSandboxProviders: availableBackends(statuses),
      hooks,
      defaultSandbox: isSandboxProviderId(defaultSandbox) ? defaultSandbox : 'none',
      sandboxCliAccess: isSandboxCliAccess(sandboxCliAccess) ? sandboxCliAccess : 'read',
    });
  } catch {
    // Swallowed: with no config the cards render without sandbox and hook
    // affordances, and the next load fills them in.
  }
}

export async function loadScripts(projectPath: string): Promise<void> {
  const isLatest = scriptLoads.begin(projectPath);
  try {
    const scripts = await window.api.scripts.getAll(projectPath);
    if (isLatest()) setScripts(projectPath, scripts);
  } catch (err) {
    useProjectStore
      .getState()
      .addToast(`Failed to load scripts: ${err instanceof Error ? err.message : String(err)}`, 'error');
  }
}

function setScripts(projectPath: string, scripts: Script[]): void {
  useProjectDataStore.setState((s) => ({ scriptsByProject: { ...s.scriptsByProject, [projectPath]: scripts } }));
}

function setConfig(projectPath: string, config: ProjectConfig): void {
  useProjectDataStore.setState((s) => ({ configByProject: { ...s.configByProject, [projectPath]: config } }));
}

function patchConfig(projectPath: string, patch: (config: ProjectConfig) => Partial<ProjectConfig>): void {
  const config = useProjectDataStore.getState().configByProject[projectPath];
  if (config) setConfig(projectPath, { ...config, ...patch(config) });
}

export function refreshProjectData(projectPath: string, resource: string): void {
  const { configByProject, scriptsByProject } = useProjectDataStore.getState();
  if (resource === 'scripts') {
    if (scriptsByProject[projectPath]) void loadScripts(projectPath);
  } else if (resource === 'hooks' || resource === 'sandbox') {
    if (configByProject[projectPath]) void loadProjectConfig(projectPath);
  } else {
    void loadTasks(projectPath);
  }
}

export async function saveHook(projectPath: string, hook: ScriptHook): Promise<{ success: boolean }> {
  const result = await window.api.hooks.save(projectPath, hook);
  if (result.success) patchConfig(projectPath, (c) => ({ hooks: { ...c.hooks, [hook.type]: hook } }));
  return result;
}

export async function deleteHook(projectPath: string, hookType: HookType): Promise<void> {
  await window.api.hooks.delete(projectPath, hookType);
  patchConfig(projectPath, (c) => {
    const { [hookType]: _deleted, ...hooks } = c.hooks;
    return { hooks };
  });
}

/** Loads the project's config first when nothing has, so a project never opened still gets its own default. */
export async function projectDefaultSandbox(projectPath: string): Promise<SandboxProviderId> {
  if (!getProjectConfig(projectPath)) await loadProjectConfig(projectPath);
  return getProjectConfig(projectPath)?.defaultSandbox ?? 'none';
}

export async function setDefaultSandbox(projectPath: string, sandbox: SandboxProviderId): Promise<void> {
  const { success } = await window.api.globalSettings.set(defaultSandboxSettingKey(projectPath), sandbox);
  if (success) patchConfig(projectPath, () => ({ defaultSandbox: sandbox }));
}

export async function setSandboxCliAccess(projectPath: string, access: SandboxCliAccess): Promise<void> {
  const { success } = await window.api.globalSettings.set(sandboxCliAccessSettingKey(projectPath), access);
  if (success) patchConfig(projectPath, () => ({ sandboxCliAccess: access }));
}

export async function saveScript(projectPath: string, script: Script): Promise<Script | null> {
  const result = await window.api.scripts.save(projectPath, script).catch((): null => null);
  if (!result?.success || !result.script) {
    useProjectStore.getState().addToast('Failed to save script', 'error');
    return null;
  }
  void loadScripts(projectPath);
  return result.script;
}

export async function reorderScripts(projectPath: string, reordered: Script[]): Promise<void> {
  setScripts(projectPath, reordered);
  await window.api.scripts.reorder(
    projectPath,
    reordered.map((s) => s.id),
  );
  void loadScripts(projectPath);
}

let moveCounter = 0;

export async function moveTask(
  projectPath: string,
  taskNumber: number,
  newStatus: TaskStatus,
  targetIndex: number,
): Promise<void> {
  const prev = useAppStore.getState().taskCacheByProject[projectPath] ?? EMPTY_TASKS;
  const moveVersion = ++moveCounter;
  const task = prev.find((t) => t.taskNumber === taskNumber);
  if (!task) return;
  const updated = prev.filter((t) => t.taskNumber !== taskNumber);
  const statusTasks = updated.filter((t) => t.status === newStatus);
  const otherTasks = updated.filter((t) => t.status !== newStatus);
  statusTasks.splice(targetIndex, 0, { ...task, status: newStatus });
  setTasks(projectPath, [...otherTasks, ...statusTasks.map((t, i) => ({ ...t, order: i }))]);

  const rollbackOrReload = () => {
    if (moveCounter === moveVersion) setTasks(projectPath, prev);
    else void loadTasks(projectPath);
    useProjectStore.getState().addToast('Failed to move task', 'error');
  };

  try {
    const result = await window.api.task.reorder(projectPath, taskNumber, newStatus, targetIndex);
    if (!result.success) rollbackOrReload();
    else if (moveCounter !== moveVersion) void loadTasks(projectPath);
  } catch {
    rollbackOrReload();
  }
}

/** Load-once, kept current afterwards by the writers above and `refreshProjectData`. */
function useLoadOnce(projectPath: string, kind: string, loaded: boolean, load: (path: string) => Promise<void>) {
  useEffect(() => {
    if (!projectPath || loaded) return;
    const key = `${kind}\0${projectPath}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    void load(projectPath).finally(() => inFlight.delete(key));
  }, [projectPath, kind, loaded, load]);
}

export function useProjectTasks(projectPath: string): TaskWithWorkspace[] {
  const tasks = useAppStore((s) => s.taskCacheByProject[projectPath]);
  useLoadOnce(projectPath, 'tasks', tasks !== undefined, loadTasks);
  return tasks ?? EMPTY_TASKS;
}

export function useProjectTask(projectPath: string, taskNumber: number | null): TaskWithWorkspace | undefined {
  const tasks = useProjectTasks(taskNumber == null ? '' : projectPath);
  return taskNumber == null ? undefined : tasks.find((t) => t.taskNumber === taskNumber);
}

/** Undefined until the project's config has loaded. */
export function useProjectConfig(projectPath: string): ProjectConfig | undefined {
  const config = useProjectDataStore((s) => s.configByProject[projectPath]);
  useLoadOnce(projectPath, 'config', config !== undefined, loadProjectConfig);
  return config;
}

/** Undefined until the project's scripts have loaded. */
export function useProjectScripts(projectPath: string): Script[] | undefined {
  const scripts = useProjectDataStore((s) => s.scriptsByProject[projectPath]);
  useLoadOnce(projectPath, 'scripts', scripts !== undefined, loadScripts);
  return scripts;
}

export function getProjectTasks(projectPath: string): TaskWithWorkspace[] {
  return useAppStore.getState().taskCacheByProject[projectPath] ?? EMPTY_TASKS;
}

export function getProjectConfig(projectPath: string): ProjectConfig | undefined {
  return useProjectDataStore.getState().configByProject[projectPath];
}
