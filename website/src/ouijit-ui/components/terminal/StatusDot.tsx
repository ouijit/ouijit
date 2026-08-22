import type { CSSProperties } from 'react';

interface StatusDotProps {
  summaryType: string;
  /** Draws the sandbox ring. The app derives this from its sandbox provider;
   *  the site's demos only need the boolean. */
  sandboxed?: boolean;
  size?: number;
}

const COLORS: Record<string, string> = {
  thinking: 'var(--color-status-thinking)',
  ready: 'var(--color-status-ready)',
  success: 'var(--color-status-ready)',
  error: 'var(--color-error)',
};

export function StatusDot({ summaryType, sandboxed = false, size = 6 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  const background = COLORS[summaryType] ?? COLORS.ready;
  return (
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
  );
}
