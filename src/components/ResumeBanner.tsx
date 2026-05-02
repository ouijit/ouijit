/**
 * One-shot at-launch affordance: if a session snapshot was persisted on the
 * previous quit and any of its terminals are still restorable, show a banner
 * offering to resume them. Hidden once acted on (Resume or Dismiss clears
 * the snapshot).
 */

import { useEffect, useState } from 'react';
import { readSnapshot, clearSnapshot } from './terminal/sessionSnapshot';
import { countRestorable, restoreSession } from './terminal/sessionRestore';
import type { LastSessionSnapshot } from '../types';

export function ResumeBanner() {
  const [snapshot, setSnapshot] = useState<LastSessionSnapshot | null>(null);
  const [counts, setCounts] = useState<{ total: number; projects: number } | null>(null);
  const [resuming, setResuming] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await readSnapshot();
      if (cancelled || !snap || snap.terminals.length === 0) return;
      const c = await countRestorable(snap);
      if (cancelled) return;
      if (c.total === 0) {
        // Nothing left worth restoring — clear silently.
        await clearSnapshot();
        return;
      }
      setSnapshot(snap);
      setCounts(c);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !snapshot || !counts) return null;

  const handleResume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      await restoreSession(snapshot);
    } finally {
      await clearSnapshot();
      setDismissed(true);
    }
  };

  const handleDismiss = async () => {
    setDismissed(true);
    await clearSnapshot();
  };

  const { total, projects } = counts;
  const terminalLabel = total === 1 ? 'terminal' : 'terminals';
  const projectLabel = projects === 1 ? 'project' : 'projects';

  return (
    <div
      className="glass-bevel relative border border-black/60 rounded-[14px] flex items-center gap-3 px-5 py-3"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-sm text-text-primary leading-tight">Resume last session</span>
        <span className="text-[11px] text-text-tertiary mt-0.5">
          {total} {terminalLabel} across {projects} {projectLabel}
        </span>
      </div>
      <div className="flex items-center gap-2 [-webkit-app-region:no-drag] shrink-0">
        <button
          type="button"
          onClick={handleDismiss}
          disabled={resuming}
          className="px-3 py-1.5 text-xs text-text-secondary rounded-full hover:bg-white/[0.04] transition-colors disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className="px-4 py-1.5 text-xs font-medium text-white bg-accent rounded-full hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 disabled:opacity-60"
        >
          {resuming ? 'Resuming…' : 'Resume'}
        </button>
      </div>
    </div>
  );
}
