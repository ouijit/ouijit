import { Tooltip } from '../ui/Tooltip';
import type { SandboxProviderId } from '../../types';

interface StatusDotProps {
  summaryType: string;
  sandboxed?: boolean;
  /** Backend name shown in the tooltip; falls back to "Sandboxed". */
  sandboxProvider?: SandboxProviderId;
  size?: number;
}

const PROVIDER_LABELS: Record<SandboxProviderId, string> = {
  none: 'Sandboxed',
  lima: 'Lima VM',
  nono: 'nono',
};

const COLORS: Record<string, string> = {
  thinking: '#da77f2',
  ready: '#4ee82e',
  success: '#4ee82e',
  error: '#ff453a',
};

const LABELS: Record<string, string> = {
  thinking: 'Thinking',
  ready: 'Ready',
  error: 'Failed',
};

export function StatusDot({ summaryType, sandboxed = false, sandboxProvider, size = 6 }: StatusDotProps) {
  const isThinking = summaryType === 'thinking';
  const background = COLORS[summaryType] ?? COLORS.ready;
  const label = LABELS[summaryType] ?? LABELS.ready;
  const sandboxLabel =
    sandboxProvider && sandboxProvider !== 'none' ? PROVIDER_LABELS[sandboxProvider] : PROVIDER_LABELS.none;
  const tooltipText = sandboxed ? `${label} · ${sandboxLabel}` : label;
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
          ...(sandboxed ? { outline: '1.5px solid rgba(116, 192, 252, 0.6)', outlineOffset: '2px' } : {}),
        }}
      />
    </Tooltip>
  );
}
