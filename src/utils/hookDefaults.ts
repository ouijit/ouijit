import type { HealthStatus } from '../healthCheck';
import { useAppStore } from '../stores/appStore';
import type { HookType } from '../types';

const START_PROMPT = 'complete the current task and move it into in review';
const REVIEW_PROMPT = 'open a pull request for the current task';

const DEFAULTS: Record<HookType, string> = {
  start: `claude "${START_PROMPT}"`,
  continue: 'claude -c',
  run: 'npm run dev',
  review: `claude "${REVIEW_PROMPT}"`,
  done: 'git push origin HEAD',
  editor: 'code',
};

const OPENCODE_DEFAULTS: Partial<Record<HookType, string>> = {
  start: `opencode --prompt "${START_PROMPT}"`,
  continue: 'opencode -c',
  review: `opencode --prompt "${REVIEW_PROMPT}"`,
};

function getHookCommandDefault(hookType: HookType, health: HealthStatus | null): string {
  const useOpenCode = !!health?.opencode && !health.claude;
  return (useOpenCode && OPENCODE_DEFAULTS[hookType]) || DEFAULTS[hookType];
}

export function useHookCommandDefault(hookType: HookType): string {
  return useAppStore((s) => getHookCommandDefault(hookType, s.health));
}
