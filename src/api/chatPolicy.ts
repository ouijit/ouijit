import { getGlobalSetting, getHooks } from '../db';
import {
  defaultSandboxSettingKey,
  isActiveSandbox,
  isSandboxProviderId,
  type SandboxProviderId,
} from '../sandbox/types';
import { chatHost } from '../chat/host';

/**
 * Chat reaches the whole API, so it can run the board, but its own sandbox
 * has to mean something. Nothing it sets off runs on the user's computer
 * without them: what it starts runs sandboxed, a hook it would run on the host
 * waits for the user, and what decides what runs there later — hooks, scripts,
 * the Custom launcher — is the user's to change. Done and trash, which can't
 * be undone, wait for the user too; the router holds those.
 *
 * Null when Chat may go ahead.
 */
export function chatRefusal(method: string, segments: string[], body: Record<string, unknown>): string | null {
  const [resource, , sub] = segments;
  const route = `${method} ${segments.join('/')}`;

  if (resource === 'sandbox' && method !== 'GET') {
    return "The Custom sandbox's launcher runs on the user's computer, so Chat can't change or use it.";
  }
  if ((resource === 'hooks' || resource === 'scripts') && method !== 'GET') {
    return `${resource === 'hooks' ? 'Hooks' : 'Scripts'} run on the user's computer when they start them, so only they change them. Tell them what to set.`;
  }
  if (body.hookMode === 'command') {
    return 'Chat runs a hook as configured, or none; it cannot pass a command of its own.';
  }
  if (body.hookSandbox !== undefined && !isActiveSandbox(body.hookSandbox as SandboxProviderId)) {
    return 'What Chat starts runs in a sandbox.';
  }
  if (route === 'POST terminals' && body.sandbox !== undefined && !isActiveSandbox(body.sandbox as SandboxProviderId)) {
    return 'A terminal Chat opens runs in a sandbox.';
  }
  if (resource === 'panels' && method === 'POST' && segments[2] === 'runner') {
    return "A runner runs a project script on the user's computer. Ask them to run it, with `ouijit ask script`.";
  }
  if (resource === 'chats' && method === 'POST' && (sub === 'messages' || sub === 'requests')) {
    const target = chatHost.list().find((info) => info.id === segments[1]);
    if (target && !isActiveSandbox(target.sandbox as SandboxProviderId | null)) {
      return "That agent runs on the user's computer, outside a sandbox, so only they steer it or answer its requests. Tell them what it needs.";
    }
  }
  return null;
}

/**
 * The sandbox a task Chat starts, or a terminal it opens, runs in: the one
 * asked for, the hook's own or the project's default where that is a sandbox,
 * else Ouijit's.
 */
export async function chatSandbox(
  projectPath: string,
  chosen: unknown,
  hook: 'start' | 'continue' | null,
): Promise<SandboxProviderId> {
  if (isSandboxProviderId(chosen) && isActiveSandbox(chosen)) return chosen;
  const [hooks, projectDefault] = await Promise.all([
    getHooks(projectPath),
    getGlobalSetting(defaultSandboxSettingKey(projectPath)),
  ]);
  for (const candidate of [hook ? hooks[hook]?.sandbox : undefined, projectDefault]) {
    if (isSandboxProviderId(candidate) && isActiveSandbox(candidate)) return candidate;
  }
  return 'nono';
}
