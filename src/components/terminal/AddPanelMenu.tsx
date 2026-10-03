import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalReact';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import type { RunnerScript, Script } from '../../types';

interface AddPanelMenuProps {
  ptyId: string;
  projectPath: string;
  /** Anchor position (the "+" button's bottom-left). */
  x: number;
  y: number;
  onAddRunner: (script?: RunnerScript) => void;
  onAddWebPreview: () => void;
  onAddPlan: (planPath: string) => void;
  onConfigureRun: () => void;
  onNewScript: () => void;
  onClose: () => void;
}

export function AddPanelMenu({
  ptyId,
  projectPath,
  x,
  y,
  onAddRunner,
  onAddWebPreview,
  onAddPlan,
  onConfigureRun,
  onNewScript,
  onClose,
}: AddPanelMenuProps) {
  const commands = useProjectCommands(projectPath);

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  if (commands) {
    if (commands.hasRunHook) {
      items.push({ label: 'Run', onClick: () => onAddRunner() });
    } else {
      items.push({ label: 'Configure run command…', onClick: onConfigureRun });
    }
    for (const script of commands.scripts) {
      items.push({ label: script.name, onClick: () => onAddRunner(script) });
    }
    items.push({ label: 'New script…', onClick: onNewScript });
  }

  items.push({ separator: true });
  items.push({ label: 'Web Preview', icon: 'globe-simple', onClick: onAddWebPreview });
  items.push({ label: 'Markdown File', icon: 'file-text', onClick: () => void pickPlanFile() });

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

interface ProjectCommands {
  hasRunHook: boolean;
  scripts: Script[];
}

/**
 * The store holds the open project's commands, but the home view shows
 * terminals from every project, so any other project's are read directly.
 * Null until they arrive, so the menu never offers to configure a run command
 * that already exists.
 */
function useProjectCommands(projectPath: string): ProjectCommands | null {
  const isStoreProject = useProjectStore(
    (s) => s.configProjectPath === projectPath && s.scriptsProjectPath === projectPath,
  );
  const storeHasRunHook = useProjectStore((s) => !!s.configuredHooks.run);
  const storeScripts = useProjectStore((s) => s.scripts);
  const [fetched, setFetched] = useState<ProjectCommands | null>(null);

  useEffect(() => {
    if (isStoreProject) return;
    let cancelled = false;
    Promise.all([window.api.hooks.get(projectPath), window.api.scripts.getAll(projectPath)])
      .then(([hooks, scripts]) => {
        if (!cancelled) setFetched({ hasRunHook: !!hooks.run, scripts });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStoreProject, projectPath]);

  return isStoreProject ? { hasRunHook: storeHasRunHook, scripts: storeScripts } : fetched;
}
