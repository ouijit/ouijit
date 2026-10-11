import { useEffect, useState } from 'react';
import { availableBackends, useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalRegistry';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox, isSandboxProviderId, runnerSandboxSettingKey } from '../../types';
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
  const commands = useProjectCommands(projectPath);
  const [chosenPlace, setChosenPlace] = useState<SandboxProviderId | null>(null);

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  if (commands) {
    const defaultPlace = chosenPlace ?? commands.defaultSandbox;
    const places: SandboxProviderId[] = ['none', ...commands.sandboxes];
    if (!places.includes(defaultPlace)) places.push(defaultPlace);
    if (places.length > 1) {
      items.push({
        label: 'Default environment',
        value: placeLabel(defaultPlace),
        submenu: places.map((place) => ({
          label: placeLabel(place),
          checked: place === defaultPlace,
          keepOpen: true,
          onClick: () => {
            setChosenPlace(place);
            void useProjectStore.getState().setRunnerSandbox(projectPath, place);
          },
        })),
      });
    }

    const run = (script?: RunnerScript) =>
      onAddRunner(script, isActiveSandbox(defaultPlace) ? defaultPlace : undefined);
    const edit = (label: string, onClick: () => void) => ({ icon: 'pencil-simple', label: `Edit ${label}`, onClick });

    const { runHook } = commands;
    if (runHook) {
      items.push({ label: 'Run', onClick: () => run(), secondary: edit('Run', () => onConfigureRun(runHook)) });
    } else {
      items.push({ label: 'Configure run command…', onClick: () => onConfigureRun() });
    }
    for (const script of commands.scripts) {
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

function placeLabel(place: SandboxProviderId): string {
  return isActiveSandbox(place) ? SANDBOX_BACKEND_LABELS[place] : 'Host';
}

interface ProjectCommands {
  runHook?: ScriptHook;
  scripts: Script[];
  sandboxes: SandboxBackendId[];
  defaultSandbox: SandboxProviderId;
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
  const storeRunHook = useProjectStore((s) => s.hooks.run);
  const storeScripts = useProjectStore((s) => s.scripts);
  const storeSandboxes = useProjectStore((s) => s.availableSandboxProviders);
  const storeDefault = useProjectStore((s) => s.runnerSandbox);
  const [fetched, setFetched] = useState<ProjectCommands | null>(null);

  useEffect(() => {
    if (isStoreProject) return;
    let cancelled = false;
    Promise.all([
      window.api.hooks.get(projectPath),
      window.api.scripts.getAll(projectPath),
      window.api.sandbox.status(projectPath),
      window.api.globalSettings.get(runnerSandboxSettingKey(projectPath)),
    ])
      .then(([hooks, scripts, statuses, runnerSandbox]) => {
        if (cancelled) return;
        setFetched({
          runHook: hooks.run,
          scripts,
          sandboxes: availableBackends(statuses),
          defaultSandbox: isSandboxProviderId(runnerSandbox) ? runnerSandbox : 'none',
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStoreProject, projectPath]);

  return isStoreProject
    ? { runHook: storeRunHook, scripts: storeScripts, sandboxes: storeSandboxes, defaultSandbox: storeDefault }
    : fetched;
}
