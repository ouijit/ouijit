import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { getGlobalSetting } from '../db';
import { getUserDataPath } from '../paths';
import { chatHost } from './host';
import { HOME_CHAT_INSTRUCTIONS } from './homeChatInstructions';
import { HOME_CHAT_ID, HOME_CHAT_SETTING_KEYS, parseHomeChatSettings, type HomeChatSettings } from './preferences';
import type { ChatAgentId, ChatSnapshot } from './model';

const execFileAsync = promisify(execFile);

/** In a sandbox nothing asks first: the sandbox is the boundary. Agents without such a mode keep their own approvals. */
const UNATTENDED_MODE: Partial<Record<ChatAgentId, string>> = { claude: 'bypassPermissions', codex: 'never' };

export function homeChatDir(): string {
  return path.join(getUserDataPath(), 'chat');
}

export async function loadHomeChatSettings(): Promise<HomeChatSettings> {
  const stored = new Map<string, string | undefined>();
  await Promise.all(
    Object.values(HOME_CHAT_SETTING_KEYS).map(async (key) => stored.set(key, await getGlobalSetting(key))),
  );
  return parseHomeChatSettings((key) => stored.get(key));
}

/** The sandboxes grant a checkout and its `.git`, so Chat's home is a repository with nothing in it. */
async function ensureHomeChatDir(): Promise<string> {
  const dir = homeChatDir();
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(path.join(dir, '.git'));
  } catch {
    await execFileAsync('git', ['init', '-q'], { cwd: dir });
  }
  return dir;
}

/** Start Chat, or resume it, under its current settings. */
export async function startHomeChat(options: { eager?: boolean } = {}): Promise<ChatSnapshot> {
  const [settings, dir] = await Promise.all([loadHomeChatSettings(), ensureHomeChatDir()]);
  return chatHost.start({
    id: HOME_CHAT_ID,
    agent: settings.agent,
    projectPath: dir,
    cwd: dir,
    taskId: null,
    sandboxProvider: settings.sandbox,
    label: 'Chat',
    instructions: [HOME_CHAT_INSTRUCTIONS, settings.instructions.trim()].filter(Boolean).join('\n\n'),
    cliAccess: 'all',
    ...(settings.sandbox !== 'none' && { mode: UNATTENDED_MODE[settings.agent] }),
    reconfigure: true,
    eager: options.eager,
  });
}

/** A settings change restarts the agent on the same conversation. */
export async function restartHomeChat(): Promise<ChatSnapshot> {
  await chatHost.stop(HOME_CHAT_ID);
  return startHomeChat({ eager: true });
}
