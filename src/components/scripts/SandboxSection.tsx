import { useEffect, useState, type ComponentType } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxBackendId, SandboxProviderStatus } from '../../types';
import { SANDBOX_BACKEND_IDS, SANDBOX_BACKEND_LABELS } from '../../types';
import { NonoSandboxSection } from './NonoSandboxSection';
import { CustomSandboxSection } from './CustomSandboxSection';

const BACKEND_DESCRIPTIONS: Record<SandboxBackendId, string> = {
  nono: 'Kernel-level access limits on the shell itself. Starts instantly, in place on the worktree.',
  custom: 'Your own launcher. Ouijit runs it as `<command> -- <shell>` in the worktree and grants nothing itself.',
};

/** Config surface per backend; keyed by id so a new backend is a compile error until wired. */
const BACKEND_SECTIONS: Record<SandboxBackendId, ComponentType<{ projectPath: string }>> = {
  nono: NonoSandboxSection,
  custom: CustomSandboxSection,
};

interface SandboxSectionProps {
  projectPath: string;
}

export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const [active, setActive] = useState<SandboxBackendId>(SANDBOX_BACKEND_IDS[0]);
  const [statuses, setStatuses] = useState<SandboxProviderStatus[]>([]);
  // Saving a backend's config reloads this, so it doubles as the cue to re-read why one can't run.
  const available = useProjectStore((s) => s.availableSandboxProviders);
  const ActiveSection = BACKEND_SECTIONS[active];
  const unavailable = statuses.find((st) => st.providerId === active && !st.available);

  useEffect(() => {
    let cancelled = false;
    window.api.sandbox
      .status(projectPath)
      .then((next) => {
        if (!cancelled) setStatuses(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectPath, available]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1 self-start rounded-[12px] border border-bezel bg-background-secondary p-1">
          {SANDBOX_BACKEND_IDS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setActive(p)}
              className={`rounded-[9px] px-3 py-1 text-xs font-medium transition-colors ${
                active === p
                  ? 'bg-background-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {SANDBOX_BACKEND_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-tertiary">{BACKEND_DESCRIPTIONS[active]}</p>
        {unavailable?.detail && <p className="text-xs text-text-secondary">{unavailable.detail}</p>}
      </div>
      <ActiveSection projectPath={projectPath} />
    </div>
  );
}
