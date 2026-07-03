import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxProviderId } from '../../types';
import { LimaSandboxSection } from './LimaSandboxSection';
import { NonoSandboxSection } from './NonoSandboxSection';

type BackendId = Exclude<SandboxProviderId, 'none'>;

const BACKEND_INFO: Record<BackendId, { label: string; description: string }> = {
  lima: {
    label: 'Lima VM',
    description: 'Full Linux VM with its own filesystem. Boots an image, so it is slower to start.',
  },
  nono: {
    label: 'nono',
    description: 'Kernel-level access limits, no VM. Starts instantly, in place on the worktree.',
  },
};

interface SandboxSectionProps {
  projectPath: string;
}

/**
 * Routes to the config surface of whichever sandbox backends are installed. One
 * backend renders directly; with both installed, tabs switch between their
 * config menus and a caption positions the one you're viewing.
 */
export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const available = useProjectStore((s) => s.availableSandboxProviders);
  const [selected, setSelected] = useState<BackendId | null>(null);

  const providers = available.filter((p): p is BackendId => p === 'lima' || p === 'nono');
  if (providers.length === 0) return null;

  const active = selected && providers.includes(selected) ? selected : providers[0];
  const both = providers.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {both && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1 self-start rounded-[12px] border border-black/60 bg-background-secondary p-1">
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
                {BACKEND_INFO[p].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary">{BACKEND_INFO[active].description}</p>
        </div>
      )}
      {active === 'lima' ? (
        <LimaSandboxSection projectPath={projectPath} />
      ) : (
        <NonoSandboxSection projectPath={projectPath} />
      )}
    </div>
  );
}
