import type { CheckRun } from '../../github/types';
import { Icon } from '../terminal/Icon';
import { BandHeader, SECTION_IDS } from './DocumentSection';
import { checkRunAppearance } from './prFormat';

/**
 * The check rollup, as a band in the document rather than a view of its own.
 * Whether the change builds is a fact about the change, so it belongs next to
 * it — not behind a tab you have to remember to look at.
 *
 * Clicking a run opens its details in the browser. That is the one place this
 * feature deliberately hands off, since a build log is not something we render.
 */
export function ChecksSection({ checks }: { checks: CheckRun[] }) {
  const failing = checks.filter((c) => isFailure(c)).length;
  const running = checks.filter((c) => c.status && c.status !== 'COMPLETED').length;

  return (
    <section id={SECTION_IDS.checks}>
      <BandHeader
        label="Checks"
        count={checks.length}
        trailing={
          <span className="font-mono text-[11px] text-text-secondary">
            {checks.length === 0
              ? 'none reported'
              : failing > 0
                ? `${failing} failing`
                : running > 0
                  ? `${running} running`
                  : 'all passing'}
          </span>
        }
      />
      {checks.map((check, i) => {
        const appearance = checkRunAppearance(check.conclusion, check.status);
        return (
          <div
            key={`${check.name}-${i}`}
            className="flex items-center gap-2.5 px-3 py-2"
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
                className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06] transition-colors duration-100"
                title="Open details"
                onClick={() => void window.api.openExternal(check.url!)}
              >
                <Icon name="arrow-square-out" className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function isFailure(check: CheckRun): boolean {
  if (check.status && check.status !== 'COMPLETED') return false;
  return ['FAILURE', 'ERROR', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(check.conclusion ?? '');
}
