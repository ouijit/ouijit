import type { SandboxCliAccess, SandboxProviderId } from '../../types';
import { SANDBOX_LABELS, SANDBOX_PROVIDER_IDS } from '../../types';
import { setDefaultSandbox, setSandboxCliAccess, useProjectConfig } from '../../stores/projectDataStore';
import { QuietPicker } from '../ui/QuietPicker';
import { SandboxProfileRow } from './SandboxProfileRow';
import { CustomLauncherRow } from './CustomLauncherRow';
import { CARD } from './sandboxStyles';

const CLI_ACCESS: Record<SandboxCliAccess, { label: string; detail: string; option: string }> = {
  read: {
    label: 'Read only',
    detail: 'Sandboxed commands can read their task, draft comments, and ask you to run a command.',
    option: 'Read its task, draft comments, ask you to run a command',
  },
  task: {
    label: 'Its own task',
    detail: 'Sandboxed commands can also edit and move their task, add to-do tasks, and read its terminals.',
    option: 'Also edit and move its task, add to-dos, read its terminals',
  },
  all: {
    label: 'Everything',
    detail: 'Sandboxed commands can make Ouijit run anything on the host.',
    option: 'Run anything on the host through Ouijit',
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

export const CHAT_CLI_ACCESS: Partial<typeof CLI_ACCESS> = {
  read: {
    label: 'Read only',
    detail: 'Chat can read every project and follow tasks and chats, but not move tasks or message agents.',
    option: 'Read every project, follow tasks and chats',
  },
  all: CLI_ACCESS.all,
};

export function CliAccessRow({
  value,
  onChange,
  levels = ['read', 'task', 'all'],
  copy = CLI_ACCESS,
}: {
  value: SandboxCliAccess;
  onChange: (level: SandboxCliAccess) => void;
  levels?: SandboxCliAccess[];
  copy?: Partial<typeof CLI_ACCESS>;
}) {
  const text = (level: SandboxCliAccess) => copy[level] ?? CLI_ACCESS[level];
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary">Ouijit CLI access</div>
        <div className={`mt-0.5 text-xs ${value === 'all' ? 'text-error' : 'text-text-tertiary'}`}>
          {text(value).detail}
        </div>
      </div>
      <QuietPicker<SandboxCliAccess>
        label="Ouijit CLI access"
        value={value}
        options={levels}
        optionLabel={(level) => text(level).label}
        optionDetail={(level) => text(level).option}
        onChange={onChange}
      />
    </div>
  );
}
