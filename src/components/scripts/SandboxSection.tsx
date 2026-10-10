import type { ComponentType, ReactNode } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxBackendId } from '../../types';
import { SANDBOX_BACKEND_IDS, SANDBOX_BACKEND_LABELS } from '../../types';
import { NonoSandboxSection } from './NonoSandboxSection';
import { CustomSandboxSection } from './CustomSandboxSection';
import { CARD } from './sandboxStyles';

const BACKEND_DESCRIPTIONS: Record<SandboxBackendId, ReactNode> = {
  nono: 'Kernel-level access limits on the shell itself. Starts instantly, in place on the worktree.',
  custom: (
    <>
      Your own launcher, run as <code className="font-mono">&lt;command&gt; -- &lt;shell&gt;</code> in the worktree.
      Ouijit grants nothing itself.
    </>
  ),
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
  const statuses = useProjectStore((s) => (s.configProjectPath === projectPath ? s.sandboxStatuses : undefined));

  return (
    <div className="flex flex-col gap-5">
      {SANDBOX_BACKEND_IDS.map((id) => {
        const Section = BACKEND_SECTIONS[id];
        const status = statuses?.find((st) => st.providerId === id);
        return (
          <section key={id} aria-label={SANDBOX_BACKEND_LABELS[id]} className="flex flex-col gap-2">
            <div className="px-1">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-[13px] font-medium text-text-primary">{SANDBOX_BACKEND_LABELS[id]}</h3>
                {status && (
                  <span
                    className={`shrink-0 text-xs ${status.available ? 'text-text-secondary' : 'text-text-tertiary'}`}
                  >
                    {status.available ? 'Ready' : status.detail}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-tertiary">{BACKEND_DESCRIPTIONS[id]}</p>
            </div>
            <div className={CARD}>
              <Section projectPath={projectPath} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
