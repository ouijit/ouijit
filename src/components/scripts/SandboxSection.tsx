import type { SandboxCliAccess, SandboxProviderId } from '../../types';
import { SANDBOX_LABELS, SANDBOX_PROVIDER_IDS } from '../../types';
import { setDefaultSandbox, setSandboxCliAccess, useProjectConfig } from '../../stores/projectDataStore';
import { QuietPicker } from '../ui/QuietPicker';
import { SandboxProfileRow } from './SandboxProfileRow';
import { CustomLauncherRow } from './CustomLauncherRow';
import { CARD } from './sandboxStyles';

const CLI_ACCESS: Record<SandboxCliAccess, { label: string; detail: string }> = {
  read: {
    label: 'View',
    detail:
      "Read only. A task's agent sees its own task and the project's pull requests and issues; Chat sees every project. Either can draft comments and ask you to run things.",
  },
  task: {
    label: 'Own task',
    detail: 'Also move, rename and describe its own card, and add to-dos.',
  },
  all: {
    label: 'Whole board',
    detail:
      "Start and move tasks across your projects, and message the agents in its sandbox. Can't change hooks, scripts, or how tasks open, start their worktrees and are sandboxed. Anything that would run outside its sandbox waits for you.",
  },
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
              ? [`${SANDBOX_LABELS[defaultSandbox]} can't run.`, defaultStatus.detail?.replace(/\.?$/, '.')]
                  .filter(Boolean)
                  .join(' ')
              : 'Where terminals, hooks and scripts run.'}
          </div>
        </div>
        <QuietPicker<SandboxProviderId>
          inSettings
          label="Default"
          value={defaultSandbox}
          options={SANDBOX_PROVIDER_IDS}
          optionLabel={(id) => SANDBOX_LABELS[id]}
          onChange={(id) => void setDefaultSandbox(projectPath, id)}
        />
      </div>
      <SandboxProfileRow projectPath={projectPath} />
      <CustomLauncherRow projectPath={projectPath} />
      <CliAccessRow value={cliAccess} onChange={(level) => void setSandboxCliAccess(projectPath, level)} />
    </div>
  );
}

export function CliAccessRow({
  value,
  onChange,
  levels = ['read', 'task', 'all'],
}: {
  value: SandboxCliAccess;
  onChange: (level: SandboxCliAccess) => void;
  levels?: SandboxCliAccess[];
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">Ouijit CLI access</div>
        <div className="mt-0.5 text-xs text-text-tertiary">{CLI_ACCESS[value].detail}</div>
      </div>
      <QuietPicker<SandboxCliAccess>
        inSettings
        label="Ouijit CLI access"
        value={value}
        options={levels}
        optionLabel={(level) => CLI_ACCESS[level].label}
        optionDetail={(level) => CLI_ACCESS[level].detail}
        onChange={onChange}
      />
    </div>
  );
}
