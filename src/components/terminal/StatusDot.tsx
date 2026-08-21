import type { CSSProperties } from 'react';
import { Tooltip } from '../ui/Tooltip';
import type { SandboxProviderId } from '../../types';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox } from '../../types';

interface StatusDotProps {
  summaryType: string;
  sandboxProvider?: SandboxProviderId;
  size?: number;
}

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
  const tooltipText = sandboxed ? `${label} · ${SANDBOX_BACKEND_LABELS[sandboxProvider]}` : label;
  return (
    <Tooltip text={tooltipText} placement="top" delay={300}>
      <span
        className="status-dot inline-flex items-center justify-center rounded-full shrink-0"
        data-status={summaryType}
        style={
          {
            '--status-dot-size': `${size}px`,
            ...(sandboxed
              ? { '--status-ring-color': 'color-mix(in srgb, var(--color-ansi-blue) 60%, transparent)' }
              : {}),
          } as CSSProperties
        }
      >
        <span
          className="status-dot-fill rounded-full transition-all duration-200 ease-out"
          style={{
            background,
            ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
          }}
        />
      </span>
    </Tooltip>
  );
}
