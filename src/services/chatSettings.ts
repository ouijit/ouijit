import { CHAT_SETTING_KEYS, parseChatSettings, type ChatSettings, type TaskSurface } from '../chat/preferences';
import { getProjectConfig, projectTaskOpening, useProjectConfig } from '../stores/projectDataStore';
import { useHomeChatStore } from '../stores/homeChatStore';
import type { HookType, ScriptHook } from '../types';

export async function loadChatSettings(): Promise<ChatSettings> {
  const values = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(CHAT_SETTING_KEYS).map(async (key) => values.set(key, await window.api.globalSettings.get(key))),
  );
  return parseChatSettings((key) => values.get(key));
}

/** `surface` is one chosen for this opening; without it, the project's own setting decides. */
export async function opensAsChat(projectPath: string, surface: TaskSurface | undefined): Promise<boolean> {
  const [{ enabled }, opening] = await Promise.all([loadChatSettings(), projectTaskOpening(projectPath)]);
  return enabled && (surface ?? opening.surface) === 'chat';
}

/**
 * What a move runs in place of a hook. Where the task opens as a chat, the
 * chat is the agent: the project's chat Setup stands where the start hook
 * would, and the continue hook, which only reopens a terminal agent, runs nothing.
 */
export async function hookForMove(
  projectPath: string,
  hookType: HookType | null,
  surface: TaskSurface | undefined,
): Promise<ScriptHook | undefined> {
  if (!hookType) return undefined;
  if ((hookType === 'start' || hookType === 'continue') && (await opensAsChat(projectPath, surface))) {
    const command = hookType === 'start' ? (await projectTaskOpening(projectPath)).setup.trim() : '';
    return command ? { id: 'chat-start', type: 'start', name: 'Setup', command } : undefined;
  }
  return (await window.api.hooks.get(projectPath))[hookType] ?? undefined;
}

/** As far as what is loaded knows, for a caller that cannot wait: a project not yet loaded opens in a terminal. */
export function tasksOpenAsChat(projectPath: string): boolean {
  return useHomeChatStore.getState().enabled && getProjectConfig(projectPath)?.taskOpening.surface === 'chat';
}

export function useTasksOpenAsChat(projectPath: string): boolean {
  const enabled = useHomeChatStore((s) => s.enabled);
  const surface = useProjectConfig(projectPath)?.taskOpening.surface;
  return enabled && surface === 'chat';
}
