import type { CSSProperties } from 'react';

interface StatusDotProps {
  summaryType: string;
  sandboxed?: boolean;
  size?: number;
}

function ThinkingGrid({ color }: { color: string }) {
  return (
    <span className="status-dot-grid" style={{ '--status-dot-color': color } as CSSProperties}>
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

export function StatusDot({ summaryType, sandboxed = false, size = 6 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  const background = isThinking ? '#da77f2' : '#4ee82e';
  return (
    <span
      className="status-dot inline-flex items-center justify-center shrink-0"
      data-status={summaryType}
      style={
        {
          '--status-dot-size': `${size}px`,
          ...(sandboxed ? { '--status-ring-color': 'rgba(116, 192, 252, 0.6)' } : {}),
        } as CSSProperties
      }
    >
      {isThinking ? (
        <ThinkingGrid color={background} />
      ) : (
        <span className="status-dot-fill rounded-full transition-all duration-200 ease-out" style={{ background }} />
      )}
    </span>
  );
}
