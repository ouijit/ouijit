import type { SandboxCliAccess, SandboxProviderId } from '../../types';
import { SANDBOX_LABELS, SANDBOX_PROVIDER_IDS } from '../../types';
import { setDefaultSandbox, setSandboxCliAccess, useProjectConfig } from '../../stores/projectDataStore';
import { QuietPicker } from '../ui/QuietPicker';
import { SandboxProfileRow } from './SandboxProfileRow';
import { CustomLauncherRow } from './CustomLauncherRow';
import { CARD } from './sandboxStyles';

const CLI_ACCESS: Record<SandboxCliAccess, { label: string; detail: string }> = {
  read: { label: 'Read only', detail: 'Sandboxed commands can read their task and draft comments.' },
  task: { label: 'Its own task', detail: 'Sandboxed commands can also move and rename their task.' },
  all: { label: 'Everything', detail: 'Sandboxed commands can make Ouijit run anything on the host.' },
};

export function SandboxSection({ projectPath }: { projectPath: string }) {
  const config = useProjectConfig(projectPath);
  const defaultSandbox = config?.defaultSandbox ?? 'none';
  const cliAccess = config?.sandboxCliAccess ?? 'read';
  const defaultStatus = config?.sandboxStatuses.find((status) => status.providerId === defaultSandbox);
  const defaultUnavailable = defaultSandbox !== 'none' && defaultStatus && !defaultStatus.available;

  return (
    <div className={CARD}>
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary">Default</div>
          <div className={`mt-0.5 text-xs ${defaultUnavailable ? 'text-error' : 'text-text-tertiary'}`}>
            {defaultUnavailable
              ? `${SANDBOX_LABELS[defaultSandbox]} can't run. ${defaultStatus.detail.replace(/\.?$/, '.')}`
              : 'Where terminals, hooks and scripts run.'}
          </div>
        </div>
        <QuietPicker<SandboxProviderId>
          label="Default"
          value={defaultSandbox}
          options={SANDBOX_PROVIDER_IDS}
          optionLabel={(id) => SANDBOX_LABELS[id]}
          onChange={(id) => void setDefaultSandbox(projectPath, id)}
        />
      </div>
      <SandboxProfileRow projectPath={projectPath} />
      <CustomLauncherRow projectPath={projectPath} />
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-text-primary">Ouijit CLI access</div>
          <div className={`mt-0.5 text-xs ${cliAccess === 'all' ? 'text-error' : 'text-text-tertiary'}`}>
            {CLI_ACCESS[cliAccess].detail}
          </div>
        </div>
        <QuietPicker<SandboxCliAccess>
          label="Ouijit CLI access"
          value={cliAccess}
          options={['read', 'task', 'all']}
          optionLabel={(level) => CLI_ACCESS[level].label}
          onChange={(level) => void setSandboxCliAccess(projectPath, level)}
        />
      </div>
    </div>
  );
}
