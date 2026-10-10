import type { CliHookMode, RunHookResult, SandboxProviderId, ScriptHook } from '../types';

export function hookSandbox(override: SandboxProviderId | undefined, hook: ScriptHook | undefined): SandboxProviderId {
  return override ?? hook?.sandbox ?? 'none';
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
