interface StatusDotProps {
  summaryType: string;
  sandboxed?: boolean;
  size?: number;
}

export function StatusDot({ summaryType, sandboxed = false, size = 9 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  return (
    <span
      className="rounded-full shrink-0 transition-all duration-200 ease-out"
      data-status={summaryType}
      style={{
        width: size,
        height: size,
        background: isThinking ? '#da77f2' : '#4ee82e',
        boxShadow: isThinking
          ? '0 0 4px rgba(218, 119, 242, 0.5), inset 0 0 0 1px #000'
          : '0 0 4px rgba(78, 232, 46, 0.5), inset 0 0 0 1px #000',
        ...(isThinking ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
        ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
      }}
    />
  );
}
