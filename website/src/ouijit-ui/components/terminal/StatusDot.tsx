import type { CSSProperties } from 'react';

interface StatusDotProps {
  status: string;
  /** Draws the sandbox ring. The app derives this from its sandbox provider;
   *  the site's demos only need the boolean. */
  sandboxed?: boolean;
  size?: number;
  /** Finished while you were looking elsewhere. */
  unread?: boolean;
}

const COLORS: Record<string, string> = {
  thinking: 'var(--color-status-thinking)',
  ready: 'var(--color-status-ready)',
  success: 'var(--color-status-ready)',
  error: 'var(--color-error)',
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

export function StatusDot({ status, sandboxed = false, size = 6, unread }: StatusDotProps) {
  const isThinking = status === 'thinking';
  const background = unread ? 'var(--color-accent)' : (COLORS[status] ?? COLORS.ready);
  return (
    <span
      className="status-dot inline-flex items-center justify-center shrink-0"
      data-status={unread ? 'unread' : status}
      style={
        {
          '--status-dot-size': `${size}px`,
          ...(sandboxed
            ? { '--status-ring-color': 'color-mix(in srgb, var(--color-ansi-blue) 60%, transparent)' }
            : {}),
        } as CSSProperties
      }
    >
      {isThinking ? (
        <Grid color={background} />
      ) : (
        <span className="status-dot-fill rounded-full transition-all duration-200 ease-out" style={{ background }} />
      )}
    </span>
  );
}
