import { useExperimentalStore } from '../../stores/experimentalStore';
import { useProjectStore } from '../../stores/projectStore';
import { ToggleRow } from '../ui/ToggleRow';

interface ExperimentalFeaturesSectionProps {
  projectPath: string;
}

export function ExperimentalFeaturesSection({ projectPath }: ExperimentalFeaturesSectionProps) {
  const flags = useExperimentalStore((s) => s.flagsByProject[projectPath]);
  const nonoEnabled = flags?.nono ?? false;
  const githubEnabled = flags?.github ?? false;

  const handleToggleNono = async () => {
    await useExperimentalStore.getState().setFlag(projectPath, 'nono', !nonoEnabled);
    // Backend availability feeds the picker, the Open in menu, and the spawn
    // funnel via sandbox:status. Reload it so nono appears/disappears now.
    await useProjectStore.getState().loadProjectConfig(projectPath);
  };

  const handleToggleGithub = async () => {
    const next = !githubEnabled;
    await useExperimentalStore.getState().setFlag(projectPath, 'github', next);
    // The panel is a projectStore value, so leaving it selected after the
    // toggle disappears would strand the user on a panel they can't get back to.
    if (!next && useProjectStore.getState().activePanel === 'pull-requests') {
      useProjectStore.getState().setActivePanel('terminals');
    }
  };

  return (
    <div className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06] bg-terminal-bg">
      <ToggleRow
        label="nono sandbox"
        description="Run a task's terminals under nono's kernel-level access limits instead of a Lima VM."
        checked={nonoEnabled}
        onChange={handleToggleNono}
      />
      <ToggleRow
        label="GitHub"
        description="Pull request inbox and review, powered by the GitHub CLI. Requires gh on PATH and signed in."
        checked={githubEnabled}
        onChange={handleToggleGithub}
      />
    </div>
  );
}
