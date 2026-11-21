import { CHAT_SETTING_KEYS, parseChatSettings, type ChatSettings, type TaskSurface } from '../chat/preferences';
import { projectChatTaskStart } from '../stores/projectDataStore';
import type { HookType, ScriptHook } from '../types';

export async function loadChatSettings(): Promise<ChatSettings> {
  const values = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(CHAT_SETTING_KEYS).map(async (key) => values.set(key, await window.api.globalSettings.get(key))),
  );
  return parseChatSettings((key) => values.get(key));
}

export async function opensAsChat(surface: TaskSurface | undefined): Promise<boolean> {
  const settings = await loadChatSettings();
  return settings.enabled && (surface ?? settings.surface) === 'chat';
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
  if ((hookType === 'start' || hookType === 'continue') && (await opensAsChat(surface))) {
    const command = hookType === 'start' ? (await projectChatTaskStart(projectPath)).setup.trim() : '';
    return command ? { id: 'chat-start', type: 'start', name: 'Setup', command } : undefined;
  }
  return (await window.api.hooks.get(projectPath))[hookType] ?? undefined;
}
