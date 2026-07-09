import { Tooltip } from '../ui/Tooltip';
import type { SandboxProviderId } from '../../types';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox } from '../../types';

interface StatusDotProps {
  summaryType: string;
  /** Backend running the terminal; drives the sandbox outline + tooltip. Host when unset. */
  sandboxProvider?: SandboxProviderId;
  size?: number;
}

/** " (lima)" backend suffix for a sandboxed terminal label; empty for a host shell. */
export function sandboxSuffix(sandboxProvider?: SandboxProviderId): string {
  return isActiveSandbox(sandboxProvider) ? ` (${sandboxProvider})` : '';
}

const COLORS: Record<string, string> = {
  thinking: 'var(--color-status-thinking)',
  ready: 'var(--color-status-ready)',
  success: 'var(--color-status-ready)',
  error: 'var(--color-error)',
};

const LABELS: Record<string, string> = {
  thinking: 'Thinking',
  ready: 'Ready',
  error: 'Failed',
};

export function StatusDot({ summaryType, sandboxProvider, size = 6 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  const background = COLORS[summaryType] ?? COLORS.ready;
  const label = LABELS[summaryType] ?? LABELS.ready;
  const sandboxed = isActiveSandbox(sandboxProvider);
  const tooltipText = isActiveSandbox(sandboxProvider)
    ? `${label} · ${SANDBOX_BACKEND_LABELS[sandboxProvider]}`
    : label;
  return (
    <Tooltip text={tooltipText} placement="top" delay={300} offsetPx={sandboxed ? 8 : 6}>
      <span
        className="rounded-full shrink-0 transition-all duration-200 ease-out"
        data-status={summaryType}
        style={{
          width: size,
          height: size,
          background,
          ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
          ...(sandboxed
            ? {
                outline: '1.5px solid color-mix(in srgb, var(--color-ansi-blue) 60%, transparent)',
                outlineOffset: '2px',
              }
            : {}),
        }}
      />
    </Tooltip>
  );
}
