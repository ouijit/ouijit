import type { CheckRun } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { Band, SECTION_IDS } from './DocumentSection';
import { checkRunAppearance } from './prFormat';

/**
 * The check rollup, as a band in the document rather than a view of its own.
 * Whether the change builds is a fact about the change, so it belongs next to
 * it — not behind a tab you have to remember to look at.
 *
 * Passing checks open shut. Ten green rows is the least interesting thing on
 * the page, and "all passing" in the header says everything they would.
 */
export function ChecksSection({ checks }: { checks: CheckRun[] }) {
  const failing = checks.filter(isFailure).length;
  const running = checks.filter((c) => c.status && c.status !== 'COMPLETED').length;

  const summary =
    checks.length === 0
      ? 'none reported'
      : failing > 0
        ? `${failing} failing`
        : running > 0
          ? `${running} running`
          : 'all passing';

  return (
    <Band id={SECTION_IDS.checks} label="Checks" summary={summary} defaultOpen={failing > 0}>
      <div className="py-1">
        {checks.map((check, i) => {
          const appearance = checkRunAppearance(check.conclusion, check.status);
          return (
            <div key={`${check.name}-${i}`} className="group flex items-center gap-2.5 px-3 py-1">
              <Icon name={appearance.icon} className={`w-3.5 h-3.5 shrink-0 ${appearance.className}`} />
              <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-text-secondary">{check.name}</span>
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
        {checks.length === 0 && (
          <p className="px-3 py-1 font-mono text-[11px] text-text-tertiary">Nothing has reported on this change</p>
        )}
      </div>
    </Band>
  );
}

function isFailure(check: CheckRun): boolean {
  if (check.status && check.status !== 'COMPLETED') return false;
  return ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.conclusion ?? '');
}
