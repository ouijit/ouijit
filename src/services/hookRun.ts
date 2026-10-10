import type { RunHookResult } from '../components/dialogs/RunHookDialog';
import type { CliHookMode, SandboxProviderId, ScriptHook } from '../types';

/** An explicit override wins, then the hook's own setting, then the host. */
export function hookSandbox(override: SandboxProviderId | undefined, hook: ScriptHook | undefined): SandboxProviderId {
  return override ?? hook?.sandbox ?? 'none';
}

/** A hook choice made without the dialog: by CLI flags or a shift-drag. */
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
