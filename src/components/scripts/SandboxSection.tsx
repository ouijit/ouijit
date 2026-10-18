import { setRunnerSandbox, useProjectConfig } from '../../stores/projectDataStore';
import { NonoSandboxSection } from './NonoSandboxSection';
import { CustomSandboxSection } from './CustomSandboxSection';
import { CARD } from './sandboxStyles';
import { SandboxSegments, useSandboxOptions } from '../ui/SandboxPicker';

interface SandboxSectionProps {
  projectPath: string;
}

export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const runnerSandbox = useProjectConfig(projectPath)?.runnerSandbox ?? 'none';
  const runnerOptions = useSandboxOptions(projectPath, runnerSandbox);

  return (
    <div className="flex flex-col gap-3">
      <NonoSandboxSection projectPath={projectPath} />
      <CustomSandboxSection projectPath={projectPath} />
      <div className={CARD}>
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-text-primary">Default environment</div>
            <div className="mt-0.5 text-xs text-text-tertiary">
              {runnerOptions.length > 1
                ? "Run and scripts in a terminal's + menu."
                : 'Turn on nono or set a Custom command to choose a sandbox.'}
            </div>
          </div>
          {runnerOptions.length > 1 ? (
            <SandboxSegments
              options={runnerOptions}
              value={runnerSandbox}
              onChange={(sandbox) => void setRunnerSandbox(projectPath, sandbox)}
            />
          ) : (
            <span className="shrink-0 text-xs text-text-secondary">Host</span>
          )}
        </div>
      </div>
    </div>
  );
}
