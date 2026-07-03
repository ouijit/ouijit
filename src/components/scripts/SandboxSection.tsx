import { useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import type { SandboxProviderId } from '../../types';
import { LimaSandboxSection } from './LimaSandboxSection';
import { NonoSandboxSection } from './NonoSandboxSection';

const PROVIDER_LABELS: Record<Exclude<SandboxProviderId, 'none'>, string> = {
  lima: 'Lima VM',
  nono: 'nono',
};

interface SandboxSectionProps {
  projectPath: string;
}

/**
 * Routes to the config surface of whichever sandbox backends are installed. One
 * backend renders its section directly; multiple show a picker. Each backend
 * owns its own UI (Lima's YAML editor + VM controls, nono's profile + network),
 * so this component only asks which backends exist and delegates.
 */
export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const available = useProjectStore((s) => s.availableSandboxProviders);
  const [selected, setSelected] = useState<SandboxProviderId | null>(null);

  const providers = available.filter((p): p is Exclude<SandboxProviderId, 'none'> => p === 'lima' || p === 'nono');
  if (providers.length === 0) return null;

  const active =
    selected && providers.includes(selected as Exclude<SandboxProviderId, 'none'>) ? selected : providers[0];

  return (
    <div className="flex flex-col gap-3">
      {providers.length > 1 && (
        <div className="flex gap-1 p-1 bg-background-secondary border border-black/60 rounded-[12px] self-start">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelected(p)}
              className={`px-3 py-1 text-xs font-medium rounded-[9px] transition-colors ${
                active === p
                  ? 'bg-background-tertiary text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
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
