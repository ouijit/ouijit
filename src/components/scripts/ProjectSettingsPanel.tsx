import { useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { ScriptList } from './ScriptList';
import { HookList } from './HookList';
import type { HookEntry } from './HookList';
import { SandboxSection } from './SandboxSection';

const LIFECYCLE_HOOKS: HookEntry[] = [
  { type: 'start', label: 'Start', description: 'Runs when a task moves to In Progress' },
  { type: 'continue', label: 'Continue', description: 'Runs when reopening an In Progress task' },
  { type: 'review', label: 'Review', description: 'Runs when a task moves to In Review' },
  { type: 'cleanup', label: 'Cleanup', description: 'Runs when a task moves to Done' },
];

const RUN_HOOK: HookEntry[] = [{ type: 'run', label: 'Run', description: 'Runs when you click Run' }];

const EDITOR_HOOK: HookEntry[] = [
  { type: 'editor', label: 'Editor', description: 'Opens the task worktree in your editor' },
];

interface ProjectSettingsPanelProps {
  projectPath: string;
}

export function ProjectSettingsPanel({ projectPath }: ProjectSettingsPanelProps) {
  const sandboxAvailable = useAppStore((s) => s.sandboxAvailable);

  useEffect(() => {
    useProjectStore.getState().loadScripts(projectPath);
  }, [projectPath]);

  // Escape key returns to terminals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useProjectStore.getState().setActivePanel('terminals');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <div className="flex items-center gap-3 px-6 pt-4 pb-2">
        <h1 className="text-base font-semibold text-text-primary">Project Settings</h1>
      </div>
      <div className="flex-1 px-6 py-4 min-w-full max-w-2xl space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Lifecycle Hooks</h2>
          <p className="text-xs text-text-tertiary mb-4">Commands that run automatically during the task lifecycle.</p>
          <HookList projectPath={projectPath} hooks={LIFECYCLE_HOOKS} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Run Scripts</h2>
          <p className="text-xs text-text-tertiary mb-4">Commands available from the terminal run button dropdown.</p>
          <div
            className="border border-white/10 rounded-[14px] overflow-hidden divide-y divide-white/[0.06]"
            style={{
              background: 'var(--color-terminal-bg, #171717)',
              boxShadow:
                '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
            }}
          >
            <HookList projectPath={projectPath} hooks={RUN_HOOK} bare />
            <ScriptList projectPath={projectPath} bare />
          </div>
        </section>
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Editor</h2>
          <p className="text-xs text-text-tertiary mb-4">Command to open task worktrees in your editor.</p>
          <HookList projectPath={projectPath} hooks={EDITOR_HOOK} />
        </section>
        {sandboxAvailable && (
          <section>
            <h2 className="text-sm font-semibold text-text-primary mb-2">Sandbox</h2>
            <p className="text-xs text-text-tertiary mb-4">Lima VM for sandboxed terminal sessions.</p>
            <SandboxSection projectPath={projectPath} />
          </section>
        )}
      </div>
    </div>
  );
}
