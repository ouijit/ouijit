import type { CheckRun } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { checkRunAppearance } from './prFormat';

/**
 * The check rollup. Clicking a run opens its details in the browser — that is
 * the one place this feature deliberately hands off, since a build log is not
 * something we render.
 */
export function PullRequestChecks({ checks }: { checks: CheckRun[] }) {
  if (checks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-tertiary">
        <Icon name="circle" className="w-8 h-8 opacity-40" />
        <span className="text-sm">No checks reported for this pull request</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Rows run the width of the frame and are separated by the same hairline
          the board's cards use. A bordered card in here would be a second
          surface floating inside the one the panel already is. */}
      {checks.map((check, i) => {
        const appearance = checkRunAppearance(check.conclusion, check.status);
        return (
          <div
            key={`${check.name}-${i}`}
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
          >
            <Icon name={appearance.icon} className={`w-4 h-4 shrink-0 ${appearance.className}`} />
            <span className="flex-1 min-w-0 truncate font-mono text-[13px] text-text-primary">{check.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-text-tertiary">
              {check.status && check.status !== 'COMPLETED'
                ? check.status.toLowerCase().replace(/_/g, ' ')
                : (check.conclusion ?? '').toLowerCase().replace(/_/g, ' ')}
            </span>
            {check.url && (
              <button
                type="button"
                className="shrink-0 text-text-tertiary hover:text-text-primary"
                title="Open details"
                onClick={() => void window.api.openExternal(check.url!)}
              >
                <Icon name="arrow-square-out" className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
