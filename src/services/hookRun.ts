import type { CliHookMode, HookType, RunHookResult, SandboxProviderId, ScriptHook, TaskStatus } from '../types';

export function hookSandbox(
  override: SandboxProviderId | undefined,
  hook: ScriptHook | undefined,
  projectDefault: SandboxProviderId,
): SandboxProviderId {
  return override ?? hook?.sandbox ?? projectDefault;
}

export interface HookControl {
  mode: CliHookMode;
  /** The one-off command, required when `mode` is `command`. */
  command?: string;
}

/** What a hook mode chosen without the dialog runs; null runs no hook. */
export function headlessHookRun(
  control: HookControl,
  hook: ScriptHook | undefined,
  sandbox: SandboxProviderId,
): RunHookResult | null {
  if (control.mode === 'command' && control.command) return { command: control.command, foreground: false, sandbox };
  if (control.mode === 'run' && hook) return { command: hook.command, foreground: false, sandbox };
  return null;
}

export function hookTypeForTransition(origStatus: TaskStatus, newStatus: TaskStatus): HookType | null {
  if (origStatus === newStatus) return null;
  if (newStatus === 'in_progress') return origStatus === 'todo' ? 'start' : 'continue';
  if (newStatus === 'in_review') return 'review';
  // 'done' is handled by completeTask, not beginTransition.
  return null;
}
