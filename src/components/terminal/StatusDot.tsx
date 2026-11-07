import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '../ui/Tooltip';
import type { SandboxProviderId } from '../../types';
import type { TerminalStatus } from '../../stores/terminalDisplay';
import type { RunnerStatus } from './panelTypes';
import { SANDBOX_LABELS, isActiveSandbox } from '../../types';

interface StatusDotProps {
  status: TerminalStatus;
  sandboxProvider?: SandboxProviderId;
  size?: number;
  /** Wants you: finished while you were elsewhere, or asking to run something, which it may be thinking through. */
  unread?: boolean;
}

export function sandboxSuffix(sandboxProvider?: SandboxProviderId): string {
  return isActiveSandbox(sandboxProvider) ? ` (${SANDBOX_LABELS[sandboxProvider]})` : '';
}

const COLORS: Record<TerminalStatus, string> = {
  thinking: 'var(--color-status-thinking)',
  ready: 'var(--color-status-ready)',
  success: 'var(--color-status-ready)',
  error: 'var(--color-error)',
};

const LABELS: Record<TerminalStatus, string> = {
  thinking: 'Thinking',
  ready: 'Ready',
  success: 'Ready',
  error: 'Failed',
};

function Grid({ color }: { color: string }) {
  return (
    <span className="status-dot-grid" style={{ '--status-dot-color': color } as CSSProperties}>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

/** The dot's footprint, outlined when what it stands for runs sandboxed. */
export function SandboxRing({
  sandboxed,
  size,
  status,
  children,
}: {
  sandboxed: boolean;
  size: number;
  status?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="status-dot inline-flex items-center justify-center shrink-0"
      data-status={status}
      style={
        {
          '--status-dot-size': `${size}px`,
          ...(sandboxed
            ? { '--status-ring-color': 'color-mix(in srgb, var(--color-ansi-blue) 60%, transparent)' }
            : {}),
        } as CSSProperties
      }
    >
      {children}
    </span>
  );
}

/** The dot alone, for a place that already says what it means. */
export function StatusGlyph({ status, sandboxProvider, size = 6, unread }: StatusDotProps) {
  const background = unread ? 'var(--color-status-unread)' : COLORS[status];
  return (
    <SandboxRing sandboxed={isActiveSandbox(sandboxProvider)} size={size} status={unread ? 'unread' : status}>
      {status === 'thinking' && !unread ? (
        <Grid color={background} />
      ) : (
        <span className="status-dot-fill rounded-full transition-all duration-200 ease-out" style={{ background }} />
      )}
    </SandboxRing>
  );
}

export function StatusDot({ status, sandboxProvider, size = 6, unread }: StatusDotProps) {
  const label = unread ? 'Finished' : LABELS[status];
  const tooltipText = isActiveSandbox(sandboxProvider) ? `${label} · ${SANDBOX_LABELS[sandboxProvider]}` : label;
  return (
    <Tooltip text={tooltipText} placement="top" delay={300}>
      <StatusGlyph status={status} sandboxProvider={sandboxProvider} size={size} unread={unread} />
    </Tooltip>
  );
}

const RUNNER_DOT: Record<RunnerStatus, string> = {
  running: 'bg-status-ready',
  success: 'bg-status-ready',
  error: 'bg-ansi-red',
  idle: 'bg-ink/30',
};

/** A runner's state, ringed as a terminal's dot is when it runs sandboxed. */
export function RunnerDot({ status, sandboxProvider }: { status: RunnerStatus; sandboxProvider?: SandboxProviderId }) {
  return (
    <SandboxRing sandboxed={isActiveSandbox(sandboxProvider)} size={6}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RUNNER_DOT[status]}`} />
    </SandboxRing>
  );
}
