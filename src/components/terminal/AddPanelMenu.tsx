import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalReact';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { ScriptConfigDialog } from '../dialogs/ScriptConfigDialog';
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
  // Config and scripts are both loaded centrally by ProjectViewReact on project
  // switch (version-guarded), so we read them straight from the store here — no
  // self-load. The store always reflects the active project's commands.
  const hasRunHook = useProjectStore((s) => !!s.configuredHooks.run);
  const scripts = useProjectStore((s) => s.scripts);
  const [menuOpen, setMenuOpen] = useState(true);
  const [dialog, setDialog] = useState<'run' | 'script' | null>(null);

  // ContextMenu closes itself before running the picked item, so the menu
  // closing must not end this component while that item opens a dialog.
  useEffect(() => {
    if (!menuOpen && !dialog) onClose();
  }, [menuOpen, dialog, onClose]);

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  if (hasRunHook) {
    items.push({ label: 'Run', onClick: () => onAddRunner() });
  } else {
    items.push({ label: 'Configure run command…', onClick: () => setDialog('run') });
  }
  for (const script of scripts) {
    items.push({ label: script.name, onClick: () => onAddRunner(script) });
  }
  items.push({ label: 'New script…', onClick: () => setDialog('script') });

  items.push({ separator: true });
  items.push({ label: 'Web Preview', icon: 'globe-simple', onClick: onAddWebPreview });
  items.push({ label: 'Markdown File', icon: 'file-text', onClick: () => void pickPlanFile() });

  if (dialog === 'run') {
    return (
      <HookConfigDialog
        projectPath={projectPath}
        hookType="run"
        onClose={(result) => {
          if (result?.saved && result.hook) {
            useProjectStore.getState().markHookConfigured('run');
            onAddRunner();
          }
          setDialog(null);
        }}
      />
    );
  }

  if (dialog === 'script') {
    return (
      <ScriptConfigDialog
        projectPath={projectPath}
        onClose={(script) => {
          if (script) onAddRunner(script);
          setDialog(null);
        }}
      />
    );
  }

  if (!menuOpen) return null;

  return <ContextMenu x={x} y={y} items={items} onClose={() => setMenuOpen(false)} />;
}
