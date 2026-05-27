import { Tooltip } from '../ui/Tooltip';

interface StatusDotProps {
  summaryType: string;
  sandboxed?: boolean;
  size?: number;
}

const COLORS: Record<string, string> = {
  thinking: '#da77f2',
  ready: '#4ee82e',
  running: '#ffb340',
  success: '#4ee82e',
  error: '#ff453a',
};

const LABELS: Record<string, string> = {
  thinking: 'Thinking',
  ready: 'Ready',
  running: 'Running',
  success: 'Done',
  error: 'Failed',
};

export function StatusDot({ summaryType, sandboxed = false, size = 6 }: StatusDotProps) {
  const isPulsing = summaryType === 'thinking' || summaryType === 'running';
  const background = COLORS[summaryType] ?? COLORS.ready;
  const label = LABELS[summaryType] ?? LABELS.ready;
  const tooltipText = sandboxed ? `${label} · Sandboxed` : label;
  return (
    <Tooltip text={tooltipText} placement="top" delay={300} offsetPx={sandboxed ? 8 : 6}>
      <span
        className="rounded-full shrink-0 transition-all duration-200 ease-out"
        data-status={summaryType}
        style={{
          width: size,
          height: size,
          background,
          ...(isPulsing ? { animation: 'terminal-status-pulse 1s ease-in-out infinite' } : {}),
          ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
        }}
      />
    </Tooltip>
  );
}
