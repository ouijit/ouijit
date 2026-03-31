import { useEffect, useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { ScriptList } from './ScriptList';
import { HookList } from './HookList';
import { Icon } from '../terminal/Icon';

interface ProjectSettingsPanelProps {
  projectPath: string;
}

export function ProjectSettingsPanel({ projectPath }: ProjectSettingsPanelProps) {
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

  const handleBack = useCallback(() => {
    useProjectStore.getState().setActivePanel('terminals');
  }, []);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-md bg-transparent border-none text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-colors duration-150 [&_svg]:w-5 [&_svg]:h-5"
          onClick={handleBack}
        >
          <Icon name="caret-left" />
        </button>
        <h1 className="text-base font-semibold text-text-primary">Project Settings</h1>
      </div>
      <div className="flex-1 px-6 py-6 min-w-full max-w-2xl space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Hooks</h2>
          <p className="text-xs text-text-tertiary mb-4">Commands that run automatically during the task lifecycle.</p>
          <HookList projectPath={projectPath} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-text-primary mb-2">Scripts</h2>
          <p className="text-xs text-text-tertiary mb-4">
            Custom commands available from the terminal run button dropdown.
          </p>
          <ScriptList projectPath={projectPath} />
        </section>
      </div>
    </div>
  );
}
