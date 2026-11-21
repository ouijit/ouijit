import { Tooltip } from '../ui/Tooltip';
import type { ChatSessionInfo } from '../../chat/model';

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** How full the context is, as a ring, with the numbers on hover. Without a known window, a token count. */
export function ContextUsage({
  usage,
  size = 16,
  className = '',
}: {
  usage: ChatSessionInfo['usage'];
  size?: number;
  className?: string;
}) {
  if (!usage?.contextTokens) return null;
  const { contextTokens: used, contextWindow: window } = usage;
  if (!window) {
    return <span className="text-[11px] text-text-tertiary mr-1 whitespace-nowrap">{compactCount(used)} tokens</span>;
  }
  const share = Math.min(1, used / window);
  const percent = Math.round(share * 100);
  return (
    <Tooltip
      placement="top-end"
      text={
        <span className="flex flex-col">
          <span>{percent}% of context used</span>
          <span className="font-normal text-text-secondary">
            {compactCount(used)} of {compactCount(window)} tokens
          </span>
        </span>
      }
    >
      {(ref, props) => (
        <span
          ref={ref}
          {...props}
          role="img"
          aria-label={`${percent}% of context used`}
          className={`${className} flex shrink-0 text-text-secondary`}
        >
          <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0">
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.16"
              strokeWidth="2"
            />
            <circle
              cx="8"
              cy="8"
              r={RING_RADIUS}
              fill="none"
              stroke="currentColor"
              strokeOpacity={share >= 0.9 ? 0.9 : 0.55}
              strokeWidth="2"
              strokeDasharray={`${share * RING_LENGTH} ${RING_LENGTH}`}
              strokeLinecap="round"
              transform="rotate(-90 8 8)"
            />
          </svg>
        </span>
      )}
    </Tooltip>
  );
}

function compactCount(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}
