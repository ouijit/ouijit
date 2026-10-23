import { useState } from 'react';
import { useProjectConfig, useProjectScripts } from '../../stores/projectDataStore';
import { terminalInstances } from './terminalRegistry';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { SANDBOX_LABELS, isActiveSandbox } from '../../types';
import type { RunnerScript, SandboxBackendId, SandboxProviderId, Script, ScriptHook } from '../../types';

interface AddPanelMenuProps {
  ptyId: string;
  projectPath: string;
  /** Anchor position (the "+" button's bottom-left). */
  x: number;
  y: number;
  onAddRunner: (script?: RunnerScript, sandbox?: SandboxBackendId) => void;
  onAddWebPreview: () => void;
  onAddPlan: (planPath: string) => void;
  onConfigureRun: (existing?: ScriptHook) => void;
  onNewScript: () => void;
  onEditScript: (script: Script) => void;
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
  onEditScript,
  onClose,
}: AddPanelMenuProps) {
  const config = useProjectConfig(projectPath);
  const scripts = useProjectScripts(projectPath);
  const [chosenPlace, setChosenPlace] = useState<SandboxProviderId | null>(null);

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  // Waits for both, so the menu never offers to configure a run command that
  // already exists.
  if (config && scripts) {
    const projectDefault = config.defaultSandbox;
    const place = chosenPlace ?? projectDefault;
    const places: SandboxProviderId[] = ['none', ...config.availableSandboxProviders];
    if (!places.includes(projectDefault)) places.push(projectDefault);
    places.sort((a, b) => Number(b === projectDefault) - Number(a === projectDefault));
    if (places.length > 1) {
      items.push({
        label: 'Run in',
        value: SANDBOX_LABELS[place],
        submenu: places.map((option) => ({
          label: option === projectDefault ? `Default (${SANDBOX_LABELS[option]})` : SANDBOX_LABELS[option],
          checked: option === place,
          keepOpen: true,
          onClick: () => setChosenPlace(option),
        })),
      });
    }

    const run = (script?: RunnerScript) => onAddRunner(script, isActiveSandbox(place) ? place : undefined);
    const edit = (label: string, onClick: () => void) => ({ icon: 'pencil-simple', label: `Edit ${label}`, onClick });

    const runHook = config.hooks.run;
    if (runHook) {
      items.push({ label: 'Run', onClick: () => run(), secondary: edit('Run', () => onConfigureRun(runHook)) });
    } else {
      items.push({ label: 'Configure run command…', onClick: () => onConfigureRun() });
    }
    for (const script of scripts) {
      items.push({
        label: script.name,
        onClick: () => run(script),
        secondary: edit(script.name, () => onEditScript(script)),
      });
    }
    items.push({ label: 'New script…', onClick: onNewScript });
  }

  items.push({ separator: true });
  items.push({ label: 'Web Preview', icon: 'globe-simple', onClick: onAddWebPreview });
  items.push({ label: 'Markdown File', icon: 'file-text', onClick: () => void pickPlanFile() });

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
