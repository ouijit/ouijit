import type { ReactNode } from 'react';
import { useProjectConfig } from '../../stores/projectDataStore';
import { SANDBOX_BACKEND_IDS, SANDBOX_LABELS, type SandboxProviderId } from '../../types';
import { QuietPicker } from './QuietPicker';

/**
 * Host plus each backend that can run. A chosen backend stays listed after it
 * stops being available, so the choice is visible rather than silently
 * becoming Host.
 */
export function useSandboxOptions(projectPath: string, value: SandboxProviderId | undefined): SandboxProviderId[] {
  const available = useProjectConfig(projectPath)?.availableSandboxProviders ?? [];
  return ['none', ...SANDBOX_BACKEND_IDS.filter((id) => available.includes(id) || id === value)];
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-secondary">Run in</span>
      {children}
    </div>
  );
}

/** Where one run goes, with the project default listed first and named as such. */
export function SandboxPicker({
  projectPath,
  value,
  onChange,
}: {
  projectPath: string;
  value: SandboxProviderId;
  onChange: (value: SandboxProviderId) => void;
}) {
  const options = useSandboxOptions(projectPath, value);
  const projectDefault = useProjectConfig(projectPath)?.defaultSandbox ?? 'none';
  if (options.length === 1) return null;
  const ordered = [projectDefault, ...options.filter((id) => id !== projectDefault)];
  return (
    <Row>
      <QuietPicker
        label="Run in"
        value={value}
        options={ordered}
        optionLabel={(id) => (id === projectDefault ? `Default (${SANDBOX_LABELS[id]})` : SANDBOX_LABELS[id])}
        onChange={onChange}
      />
    </Row>
  );
}

/** Where a hook always runs; undefined follows the project default. */
export function HookSandboxPicker({
  projectPath,
  value,
  onChange,
}: {
  projectPath: string;
  value: SandboxProviderId | undefined;
  onChange: (value: SandboxProviderId | undefined) => void;
}) {
  const options = useSandboxOptions(projectPath, value);
  const projectDefault = useProjectConfig(projectPath)?.defaultSandbox ?? 'none';
  if (options.length === 1) return null;
  return (
    <Row>
      <QuietPicker<SandboxProviderId | 'default'>
        label="Run in"
        value={value ?? 'default'}
        options={['default', ...options]}
        optionLabel={(id) => (id === 'default' ? `Default (${SANDBOX_LABELS[projectDefault]})` : SANDBOX_LABELS[id])}
        onChange={(id) => onChange(id === 'default' ? undefined : id)}
      />
    </Row>
  );
}
