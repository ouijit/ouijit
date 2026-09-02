import { useState, type ComponentType } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxBackendId } from '../../types';
import { SANDBOX_BACKEND_LABELS } from '../../types';
import { LimaSandboxSection } from './LimaSandboxSection';
import { NonoSandboxSection } from './NonoSandboxSection';
import { CustomSandboxSection } from './CustomSandboxSection';

const BACKEND_DESCRIPTIONS: Record<SandboxBackendId, string> = {
  lima: 'Full Linux VM with its own filesystem. Boots an image, so it is slower to start.',
  nono: 'Kernel-level access limits rather than a VM boundary. Starts instantly, in place on the worktree.',
  custom: 'Your own launcher. Ouijit runs it as `<command> -- <shell>` in the worktree and grants nothing itself.',
};

/** Config surface per backend; keyed by id so a new backend is a compile error until wired. */
const BACKEND_SECTIONS: Record<SandboxBackendId, ComponentType<{ projectPath: string }>> = {
  lima: LimaSandboxSection,
  nono: NonoSandboxSection,
  custom: CustomSandboxSection,
};

interface SandboxSectionProps {
  projectPath: string;
}

/**
 * Routes to the config surface of whichever sandbox backends are available. One
 * backend renders directly; with more than one, tabs switch between their
 * config menus and a caption positions the one you're viewing.
 */
export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const available = useProjectStore((s) => s.availableSandboxProviders);
  const [selected, setSelected] = useState<SandboxBackendId | null>(null);

  const providers = available.filter((p): p is SandboxBackendId => p !== 'none');
  if (providers.length === 0) return null;

  const active = selected && providers.includes(selected) ? selected : providers[0];
  const hasTabs = providers.length > 1;
  const ActiveSection = BACKEND_SECTIONS[active];

  return (
    <div className="flex flex-col gap-3">
      {hasTabs && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1 self-start rounded-[12px] border border-bezel bg-background-secondary p-1">
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelected(p)}
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
        </div>
      )}
      <ActiveSection projectPath={projectPath} />
    </div>
  );
}
