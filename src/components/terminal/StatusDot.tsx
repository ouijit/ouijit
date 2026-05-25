interface StatusDotProps {
  summaryType: string;
  sandboxed?: boolean;
  size?: number;
}

const COLORS: Record<string, string> = {
  thinking: '#da77f2',
  ready: '#4ee82e',
  success: '#4ee82e',
  error: '#ff453a',
};

export function StatusDot({ summaryType, sandboxed = false, size = 6 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  const background = COLORS[summaryType] ?? COLORS.ready;
  return (
    <span
      className="rounded-full shrink-0 transition-all duration-200 ease-out"
      data-status={summaryType}
      style={{
        width: size,
        height: size,
        background,
        ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
        ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
      }}
    />
  );
}
