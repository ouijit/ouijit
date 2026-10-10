import { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { terminalInstances } from './terminalRegistry';
import { ContextMenu, type ContextMenuEntry, type ContextMenuItemAction } from '../ui/ContextMenu';
import { SANDBOX_BACKEND_LABELS, isActiveSandbox } from '../../types';
import type { RunnerScript, SandboxBackendId, SandboxProviderId, Script, ScriptHook } from '../../types';

interface AddPanelMenuProps {
  ptyId: string;
  projectPath: string;
  /** Anchor position (the "+" button's bottom-left). */
  x: number;
  y: number;
  onAddRunner: (script?: RunnerScript, sandbox?: SandboxProviderId) => void;
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

  const pickPlanFile = async () => {
    const inst = terminalInstances.get(ptyId);
    const defaultDir = inst?.worktreePath || inst?.projectPath;
    const result = await window.api.plan.pickFile(defaultDir);
    if (!result.canceled && result.filePath) onAddPlan(result.filePath);
  };

  const items: ContextMenuEntry[] = [];

  if (commands) {
    const runnerActions = (script: RunnerScript | undefined, edit?: () => void): ContextMenuItemAction[] => [
      ...commands.sandboxes.map((backend) => ({
        label: `Run in ${SANDBOX_BACKEND_LABELS[backend]} sandbox`,
        icon: 'cube',
        text: SANDBOX_BACKEND_LABELS[backend],
        onClick: () => onAddRunner(script, backend),
      })),
      ...(edit ? [{ label: 'Edit', icon: 'pencil-simple', onClick: edit }] : []),
    ];

    const { runHook } = commands;
    if (commands.hasRunHook) {
      items.push({
        label: 'Run',
        onClick: () => onAddRunner(),
        detail: runHook && <CommandDetail command={runHook.command} />,
        actions: runnerActions(undefined, runHook && (() => onConfigureRun(runHook))),
      });
    } else {
      items.push({ label: 'Configure run command…', onClick: () => onConfigureRun() });
    }
    for (const script of commands.scripts) {
      items.push({
        label: script.name,
        onClick: () => onAddRunner(script),
        detail: <CommandDetail command={script.command} />,
        actions: runnerActions(script, () => onEditScript(script)),
      });
    }
    items.push({ label: 'New script…', onClick: onNewScript });
  }

  items.push({ separator: true });
  items.push({ label: 'Web Preview', icon: 'globe-simple', onClick: onAddWebPreview });
  items.push({ label: 'Markdown File', icon: 'file-text', onClick: () => void pickPlanFile() });

  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

function CommandDetail({ command }: { command: string }) {
  return <span className="font-mono text-xs whitespace-pre-wrap break-all">{command}</span>;
}

interface ProjectCommands {
  hasRunHook: boolean;
  /** For the store's project, arrives after `hasRunHook` already says there is one. */
  runHook?: ScriptHook;
  scripts: Script[];
  sandboxes: SandboxBackendId[];
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
  const storeSandboxes = useProjectStore((s) => s.availableSandboxProviders);
  const [runHook, setRunHook] = useState<ScriptHook>();
  const [fetched, setFetched] = useState<ProjectCommands | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.api.hooks.get(projectPath),
      isStoreProject ? null : window.api.scripts.getAll(projectPath),
      isStoreProject ? null : window.api.sandbox.status(projectPath),
    ])
      .then(([hooks, scripts, statuses]) => {
        if (cancelled) return;
        setRunHook(hooks.run);
        if (scripts && statuses) {
          setFetched({
            hasRunHook: !!hooks.run,
            runHook: hooks.run,
            scripts,
            sandboxes: statuses.filter((st) => st.available).map((st) => st.providerId),
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStoreProject, projectPath]);

  if (!isStoreProject) return fetched;
  return {
    hasRunHook: storeHasRunHook,
    runHook,
    scripts: storeScripts,
    sandboxes: storeSandboxes.filter(isActiveSandbox),
  };
}
