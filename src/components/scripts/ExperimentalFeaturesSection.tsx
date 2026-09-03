import { useExperimentalStore } from '../../stores/experimentalStore';
import { useProjectStore } from '../../stores/projectStore';

interface ExperimentalFeaturesSectionProps {
  projectPath: string;
}

export function ExperimentalFeaturesSection({ projectPath }: ExperimentalFeaturesSectionProps) {
  const flags = useExperimentalStore((s) => s.flagsByProject[projectPath]);
  const canvasEnabled = flags?.canvas ?? false;
  const nonoEnabled = flags?.nono ?? false;
  const customSandboxEnabled = flags?.customSandbox ?? false;
  const githubEnabled = flags?.github ?? false;
  const analysisEnabled = flags?.analysis ?? false;

  const handleToggleCanvas = async () => {
    const next = !canvasEnabled;
    await useExperimentalStore.getState().setFlag(projectPath, 'canvas', next);
    if (!next && useProjectStore.getState().terminalLayout === 'canvas') {
      useProjectStore.getState().setTerminalLayout('stack');
    }
  };

  const handleToggleNono = async () => {
    await useExperimentalStore.getState().setFlag(projectPath, 'nono', !nonoEnabled);
    // Backend availability feeds the picker, the Open in menu, and the spawn
    // funnel via sandbox:status. Reload it so the backend appears/disappears now.
    await useProjectStore.getState().loadProjectConfig(projectPath);
  };

  const handleToggleCustomSandbox = async () => {
    await useExperimentalStore.getState().setFlag(projectPath, 'customSandbox', !customSandboxEnabled);
    await useProjectStore.getState().loadProjectConfig(projectPath);
  };

  const handleToggleAnalysis = async () => {
    await useExperimentalStore.getState().setFlag(projectPath, 'analysis', !analysisEnabled);
  };

  const handleToggleGithub = async () => {
    await useExperimentalStore.getState().setFlag(projectPath, 'github', !githubEnabled);
  };

  return (
    <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
      <ToggleRow
        label="Canvas layout"
        description="React-flow based free-form terminal canvas with grouping and chain edges."
        checked={canvasEnabled}
        onChange={handleToggleCanvas}
      />
      <ToggleRow
        label="nono sandbox"
        description="Run a task's terminals under nono's kernel-level access limits instead of a Lima VM."
        checked={nonoEnabled}
        onChange={handleToggleNono}
      />
      <ToggleRow
        label="Custom sandbox"
        description="Run a task's terminals under a launcher you configure, instead of Lima or nono."
        checked={customSandboxEnabled}
        onChange={handleToggleCustomSandbox}
      />
      <ToggleRow
        label="GitHub"
        description="Pull request inbox and review, powered by the GitHub CLI. Requires gh on PATH and signed in."
        checked={githubEnabled}
        onChange={handleToggleGithub}
      />
      <ToggleRow
        label="Analysis"
        description="Hotspot, coupling, and ownership signals from git history, on the diff and pull request views and a project panel."
        checked={analysisEnabled}
        onChange={handleToggleAnalysis}
      />
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        <div className="text-xs text-text-tertiary mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 ${
          checked ? 'bg-accent' : 'bg-ink/15'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-accent-ink transition-transform duration-150 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </label>
  );
}
