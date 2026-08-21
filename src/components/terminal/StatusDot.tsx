import { Tooltip } from '../ui/Tooltip';
import type { SandboxProviderId } from '../../types';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox } from '../../types';

interface StatusDotProps {
  summaryType: string;
  /** Backend running the terminal; drives the sandbox ring + tooltip. Host when unset. */
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

const RING_WIDTH_PX = 1.5;
const RING_GAP_PX = 2;

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
  const outerSize = sandboxed ? size + 2 * (RING_GAP_PX + RING_WIDTH_PX) : size;
  return (
    <Tooltip text={tooltipText} placement="top" delay={300} offsetPx={6}>
      {/* The ring is part of the dot's own box rather than an outline around it:
          headers and pills that hold a dot clip their overflow, and anything
          painted outside the box gets cut. */}
      <span
        className="inline-flex items-center justify-center rounded-full shrink-0"
        data-status={summaryType}
        style={{
          width: outerSize,
          height: outerSize,
          ...(sandboxed
            ? { border: `${RING_WIDTH_PX}px solid color-mix(in srgb, var(--color-ansi-blue) 60%, transparent)` }
            : {}),
        }}
      >
        <span
          className="rounded-full transition-all duration-200 ease-out"
          style={{
            width: size,
            height: size,
            background,
            ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
          }}
        />
      </span>
    </Tooltip>
  );
}
