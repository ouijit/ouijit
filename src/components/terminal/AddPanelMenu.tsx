import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalReact';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import type { RunnerScript } from '../../types';

interface AddPanelMenuProps {
  ptyId: string;
  projectPath: string;
  /** Anchor position (the "+" button's bottom-left). */
  x: number;
  y: number;
  onAddRunner: (script?: RunnerScript) => void;
  onAddWebPreview: () => void;
  onAddPlan: (planPath: string) => void;
  onClose: () => void;
}

/** The "+" dropdown on the panel tab strip — creates a new panel by type. */
export function AddPanelMenu({
  ptyId,
  projectPath,
  x,
  y,
  onAddRunner,
  onAddWebPreview,
  onAddPlan,
  onClose,
}: AddPanelMenuProps) {
  const hasRunHook = useProjectStore((s) => !!s.configuredHooks.run);
  const scripts = useProjectStore((s) => s.scripts);
  const [runHookDialog, setRunHookDialog] = useState(false);

  useEffect(() => {
    if (projectPath && scripts.length === 0) {
      useProjectStore.getState().loadScripts(projectPath);
    }
  }, [projectPath, scripts.length]);

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  if (hasRunHook) {
    items.push({ label: 'Run hook', onClick: () => onAddRunner() });
  }
  for (const script of scripts) {
    items.push({ label: script.name, onClick: () => onAddRunner(script) });
  }
  if (!hasRunHook && scripts.length === 0) {
    items.push({ label: 'Configure run command…', onClick: () => setRunHookDialog(true) });
  }

  items.push({ separator: true });
  items.push({ label: 'Web Preview', icon: 'globe-simple', onClick: onAddWebPreview });
  items.push({ label: 'Markdown File', icon: 'file-text', onClick: () => void pickPlanFile() });

  if (runHookDialog) {
    return (
      <HookConfigDialog
        projectPath={projectPath}
        hookType="run"
        onClose={(result) => {
          setRunHookDialog(false);
          if (result?.saved && result.hook) {
            useProjectStore.getState().markHookConfigured('run');
            onAddRunner();
          }
          onClose();
        }}
      />
    );
  }

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
