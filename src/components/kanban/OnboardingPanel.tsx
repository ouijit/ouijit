import { useEffect, useState, useMemo } from 'react';
import { Icon } from '../terminal/Icon';
import { useProjectStore } from '../../stores/projectStore';

interface OnboardingPanelProps {
  projectPath: string;
  onConfigureCliAgent: () => void;
  onOpenHelp: () => void;
}

const SEEDED_KEY = 'onboarding:seededProject';
const DISMISSED_KEY = 'onboarding:dismissed';

/**
 * First-run onboarding banner shown above the kanban columns on the single
 * project that received the seeded tutorial task. Disappears once the user
 * dismisses or once any task is in progress.
 */
export function OnboardingPanel({ projectPath, onConfigureCliAgent, onOpenHelp }: OnboardingPanelProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const [seededProject, setSeededProject] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.api.globalSettings.get(SEEDED_KEY), window.api.globalSettings.get(DISMISSED_KEY)]).then(
      ([seeded, dismissedVal]) => {
        if (cancelled) return;
        setSeededProject(seeded ?? undefined);
        setDismissed(dismissedVal === '1');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const hasStartedAnyTask = useMemo(
    () => tasks.some((t) => t.status === 'in_progress' || t.status === 'in_review' || t.status === 'done'),
    [tasks],
  );

  if (seededProject === undefined || dismissed === undefined) return null;
  if (seededProject !== projectPath) return null;
  if (dismissed) return null;
  if (hasStartedAnyTask) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await window.api.globalSettings.set(DISMISSED_KEY, '1');
  };

  return (
    <div
      className="mx-3 mt-3 mb-2 px-4 py-3 rounded-[12px] border border-white/10 flex items-start gap-3"
      style={{ background: 'rgba(255, 255, 255, 0.03)' }}
    >
      <div
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-accent [&>svg]:w-5 [&>svg]:h-5"
        style={{ background: 'rgba(10, 132, 255, 0.12)' }}
      >
        <Icon name="rocket" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary mb-1">Welcome to Ouijit</div>
        <div className="text-xs text-text-secondary leading-relaxed mb-3">
          We seeded a tutorial task below. Set up a start hook to launch your CLI agent (Claude, Codex, etc.), then drag
          the tutorial card to In Progress. The agent will use the{' '}
          <code className="px-1 py-0.5 rounded bg-white/5 font-mono">ouijit</code> CLI to drive the board itself. Watch
          the card move across columns live.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-white bg-accent hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 ease-out"
            onClick={onConfigureCliAgent}
          >
            <Icon name="terminal" className="w-3.5 h-3.5" />
            Set up your CLI agent
          </button>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-white/5 hover:bg-white/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
            onClick={onOpenHelp}
          >
            <Icon name="question" className="w-3.5 h-3.5" />
            Need help?
          </button>
        </div>
      </div>
      <button
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-white/10 transition-colors [&>svg]:w-4 [&>svg]:h-4"
        onClick={handleDismiss}
        aria-label="Dismiss onboarding"
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
