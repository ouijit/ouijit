import { useState, useEffect } from 'react';
import { Icon } from './terminal/Icon';
import type { CloneJob } from '../types';

/**
 * Where a clone is watched. Stands in for the whole project view, so none of
 * the project machinery — git status polling, terminal reconnection, task
 * loading — ever runs against a directory that is not there yet.
 */
export function CloningProjectView({ job }: { job: CloneJob }) {
  const [busy, setBusy] = useState(false);
  const failed = job.status === 'failed';

  const dismiss = async () => {
    setBusy(true);
    await window.api.cancelClone(job.projectPath);
  };

  const retry = async () => {
    setBusy(true);
    // The failed entry holds this project's path; it has to go before a new
    // clone can claim the same one.
    await window.api.cancelClone(job.projectPath);
    await window.api.startClone({ repo: job.slug, parentDir: job.parentDir });
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="w-full max-w-[32rem] flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-primary">{failed ? 'Could not clone' : 'Cloning'}</span>
          <span className="font-mono text-xs text-text-secondary">{job.slug}</span>
        </div>

        {failed ? <CloneFailure job={job} /> : <CloneProgressBar job={job} />}

        <div className="flex gap-2">
          {failed ? (
            <>
              <button className="btn-primary" onClick={retry} disabled={busy}>
                Try again
              </button>
              <button className="btn-secondary" onClick={dismiss} disabled={busy}>
                Dismiss
              </button>
            </>
          ) : (
            <button className="btn-secondary" onClick={dismiss} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CloneProgressBar({ job }: { job: CloneJob }) {
  return (
    <>
      <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
        <div
          className={job.percent === null ? 'h-full w-1/3 rounded-full clone-bar-sweep' : 'h-full rounded-full'}
          style={{
            background: 'var(--color-accent)',
            width: job.percent === null ? undefined : `${job.percent}%`,
            transition: job.percent === null ? undefined : 'width 200ms linear',
          }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-xs text-text-tertiary">
        <span className="truncate">
          {job.phase}
          {job.detail ? ` · ${job.detail}` : ''}
        </span>
        <Elapsed since={job.startedAt} />
      </div>
    </>
  );
}

function CloneFailure({ job }: { job: CloneJob }) {
  const [showOutput, setShowOutput] = useState(false);
  return (
    <>
      <p className="text-xs text-error">{job.error}</p>
      {job.output && (
        <div className="flex flex-col gap-2 items-start">
          <button className="btn-secondary" onClick={() => setShowOutput((open) => !open)}>
            {showOutput ? 'Hide output' : 'Show output'}
          </button>
          {showOutput && (
            <pre className="w-full max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] text-text-secondary whitespace-pre-wrap">
              {job.output.trim()}
            </pre>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The one signal that always works. Progress can sit still for a long time —
 * `Enumerating objects` runs on GitHub's side, before a single byte arrives —
 * and a stalled percentage is indistinguishable from a hang without this.
 */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const label = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return (
    <span className="shrink-0 flex items-center gap-1 font-mono tabular-nums">
      <Icon name="clock" className="w-3 h-3" />
      {label}
    </span>
  );
}
