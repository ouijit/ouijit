import { useState, type ComponentType } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxBackendId } from '../../types';
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
  const unavailable = useProjectStore((s) =>
    s.configProjectPath === projectPath
      ? s.sandboxStatuses.find((st) => st.providerId === active && !st.available)
      : undefined,
  );
  const ActiveSection = BACKEND_SECTIONS[active];

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
