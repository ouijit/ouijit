import type { SandboxProviderId } from './sandbox/types';

/**
 * Custom command defined by the user
 * @deprecated Use ScriptHook instead
 */
export interface CustomCommand {
  id: string;
  name: string;
  command: string;
  description?: string;
}

export type HookType = 'start' | 'continue' | 'run' | 'review' | 'done' | 'editor';

export interface ScriptHook {
  id: string;
  type: HookType;
  name: string;
  command: string;
  description?: string;
  /** Restart the command if an instance is already running in the same task (run hook only). */
  restartIfRunning?: boolean;
  /** Where the hook always runs; absent follows the project default. */
  sandbox?: SandboxProviderId;
}

export interface ProjectSettings {
  /** @deprecated Use hooks instead */
  customCommands?: CustomCommand[];
  /** @deprecated Use hooks.run instead */
  defaultCommandId?: string;
  /** Script hooks for project lifecycle */
  hooks?: {
    start?: ScriptHook;
    continue?: ScriptHook;
    run?: ScriptHook;
    review?: ScriptHook;
    done?: ScriptHook;
    editor?: ScriptHook;
  };
}
