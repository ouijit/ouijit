import type { CheckRun } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { checkRunAppearance } from './prFormat';

/**
 * The check rollup. Clicking a run opens its details in the browser — the one
 * place this feature deliberately hands off, since a build log is not something
 * we render.
 */
export function ChecksSection({ checks }: { checks: CheckRun[] }) {
  if (checks.length === 0) {
    return <p className="px-4 py-4 font-mono text-[11px] text-text-tertiary">Nothing has reported on this change</p>;
  }

  return (
    <div className="py-2">
      {checks.map((check, i) => {
        const appearance = checkRunAppearance(check.conclusion, check.status);
        return (
          <div key={`${check.name}-${i}`} className="group flex items-center gap-2.5 px-4 py-1">
            <Icon name={appearance.icon} className={`w-3.5 h-3.5 shrink-0 ${appearance.className}`} />
            <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text-secondary">{check.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
              {check.status && check.status !== 'COMPLETED'
                ? check.status.toLowerCase().replace(/_/g, ' ')
                : (check.conclusion ?? '').toLowerCase().replace(/_/g, ' ')}
            </span>
            {check.url && (
              <button
                type="button"
                className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-text-primary transition-opacity duration-100"
                title="Open details"
                onClick={() => void window.api.openExternal(check.url!)}
              >
                <Icon name="arrow-square-out" className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
