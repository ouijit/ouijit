import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { addProjectTerminal } from '../terminal/terminalActions';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { Icon } from '../terminal/Icon';
import type { ScriptHook } from '../../types';

const VM_STATUS_LABELS: Record<string, string> = {
  Running: 'Running',
  Stopped: 'Stopped',
  Broken: 'Broken',
  NotCreated: 'Not created',
};

const VM_HINTS: Record<string, string> = {
  NotCreated: 'Created automatically when you open a sandbox terminal',
  Stopped: 'Started automatically when you open a sandbox terminal',
  Broken: 'VM is in a broken state. Recreate to fix.',
  Running: 'Stopped automatically when you quit Ouijit',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 10) / 10} ${units[i]}`;
}

interface SandboxDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function SandboxDropdown({ anchorRef, onClose }: SandboxDropdownProps) {
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const sandboxStarting = useAppStore((s) => s.sandboxStarting);
  const [vmStatus, setVmStatus] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [diskUsage, setDiskUsage] = useState<number | null>(null);
  const [memoryGiB, setMemoryGiB] = useState(4);
  const [diskGiB, setDiskGiB] = useState(100);
  const [setupHook, setSetupHook] = useState<ScriptHook | undefined>();
  const [hookDialog, setHookDialog] = useState(false);
  const [activeAction, setActiveAction] = useState<'starting' | 'stopping' | 'recreating' | null>(null);
  const [ready, setReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Floating UI positioning
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Set anchor as reference
  useEffect(() => {
    if (anchorRef.current) {
      refs.setReference(anchorRef.current);
    }
  }, [anchorRef, refs]);

  // Load status
  useEffect(() => {
    if (!projectPath) return;
    (async () => {
      const [status, hooks, config] = await Promise.all([
        window.api.lima.status(projectPath),
        window.api.hooks.get(projectPath),
        window.api.lima.getConfig(projectPath),
      ]);
      setVmStatus(status.vmStatus);
      setInstanceName(status.instanceName || '');
      setDiskUsage(status.disk ?? null);
      setMemoryGiB(config.memoryGiB);
      setDiskGiB(config.diskGiB);
      setSetupHook((hooks as any)['sandbox-setup'] || undefined);
      requestAnimationFrame(() => setReady(true));
    })();
  }, [projectPath]);

  // Keep vmStatus in sync while the dropdown is open
  useEffect(() => {
    if (!projectPath) return;
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(projectPath);
        setVmStatus(s.vmStatus);
        if (s.disk != null) setDiskUsage(s.disk);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [projectPath]);

  // Click outside (disabled while hook dialog is open)
  useEffect(() => {
    if (hookDialog) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef, hookDialog]);

  const handleStart = useCallback(async () => {
    if (!projectPath) return;
    setActiveAction('starting');
    useAppStore.getState().setSandboxStarting(true);
    onClose();
    window.api.lima.start(projectPath).catch(() => {});
    // Poll until running (timeout 5 min)
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(projectPath);
        if (s.vmStatus === 'Running') {
          clearInterval(poll);
          setVmStatus('Running');
          setActiveAction(null);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    setTimeout(() => {
      clearInterval(poll);
      setActiveAction(null);
    }, 300_000);
  }, [projectPath, onClose]);

  const handleStop = useCallback(async () => {
    if (!projectPath) return;
    setActiveAction('stopping');
    await window.api.lima.stop(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setActiveAction(null);
    onClose();
  }, [projectPath, onClose]);

  const handleRecreate = useCallback(async () => {
    if (!projectPath) return;
    setActiveAction('recreating');
    useAppStore.getState().setSandboxStarting(true);
    await window.api.lima.recreate(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setActiveAction(null);
    onClose();
  }, [projectPath, onClose]);

  const handleRecreateWithConfirm = useCallback(() => {
    if (!projectPath) return;
    if (confirm('This will delete the current VM and all its data, then create a fresh one.')) {
      handleRecreate();
    }
  }, [projectPath, handleRecreate]);

  const handleConsole = useCallback(() => {
    if (!projectPath) return;
    onClose();

    // If a VM console already exists, switch to it
    const termStore = useTerminalStore.getState();
    const ptyIds = termStore.terminalsByProject[projectPath] ?? [];
    const existingIndex = ptyIds.findIndex((id) => {
      const display = termStore.displayStates[id];
      return display?.sandboxed && display?.label === 'VM Console';
    });
    if (existingIndex !== -1) {
      termStore.setActiveIndex(projectPath, existingIndex);
    } else {
      addProjectTerminal(
        projectPath,
        { name: 'VM Console', command: '', source: 'custom', priority: 0 },
        { sandboxed: true },
      );
    }
    useProjectStore.getState().setKanbanVisible(false);
  }, [projectPath, onClose]);

  const handleMemoryChange = useCallback(
    async (val: number) => {
      if (!projectPath) return;
      setMemoryGiB(val);
      await window.api.lima.setConfig(projectPath, { memoryGiB: val, diskGiB });
    },
    [projectPath, diskGiB],
  );

  const handleDiskChange = useCallback(
    async (val: number) => {
      if (!projectPath) return;
      setDiskGiB(val);
      await window.api.lima.setConfig(projectPath, { memoryGiB, diskGiB: val });
    },
    [projectPath, memoryGiB],
  );

  if (!projectPath) return null;

  return (
    <>
      {createPortal(
        <div
          ref={(node) => {
            (dropdownRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            refs.setFloating(node);
          }}
          className="min-w-[240px] max-w-[272px] bg-surface border border-border rounded-md shadow-lg z-[1000] overflow-hidden transition-opacity duration-150 ease-out"
          style={{
            ...floatingStyles,
            opacity: ready ? 1 : 0,
          }}
        >
          <div className="text-[13px] text-text-tertiary px-3 pt-2 pb-1 uppercase tracking-wide">Lima Sandbox</div>

          {/* VM info rows */}
          <div className="flex flex-col pb-1">
            <div className="flex flex-col px-3 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-secondary">VM</span>
                <span className={`text-xs ${vmStatus === 'Running' && !sandboxStarting ? 'text-[#0a84ff]' : 'text-text-primary'}`}>
                  {sandboxStarting ? 'Starting\u2026' : (VM_STATUS_LABELS[vmStatus] || vmStatus)}
                </span>
              </div>
              {VM_HINTS[vmStatus] && (
                <div className="text-[13px] text-text-tertiary leading-snug pt-1 pb-0.5">{VM_HINTS[vmStatus]}</div>
              )}
            </div>

            {instanceName && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-medium text-text-secondary">Name</span>
                <span className="text-xs font-mono text-text-primary">{instanceName}</span>
              </div>
            )}

            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs font-medium text-text-secondary">Memory</span>
              <select
                className="text-xs text-text-primary bg-background-secondary border border-border rounded px-1.5 py-0.5 outline-none"
                value={memoryGiB}
                onChange={(e) => handleMemoryChange(parseInt(e.target.value, 10))}
              >
                {[2, 4, 8, 16].map((v) => (
                  <option key={v} value={v}>
                    {v} GiB
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between px-3 py-1.5">
              <span className="text-xs font-medium text-text-secondary">Disk</span>
              <select
                className="text-xs text-text-primary bg-background-secondary border border-border rounded px-1.5 py-0.5 outline-none"
                value={diskGiB}
                onChange={(e) => handleDiskChange(parseInt(e.target.value, 10))}
              >
                {[50, 100, 200].map((v) => (
                  <option key={v} value={v}>
                    {v} GiB
                  </option>
                ))}
              </select>
            </div>

            {vmStatus === 'Running' && diskUsage != null && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-medium text-text-secondary">Usage</span>
                <span className="text-xs text-text-primary">{formatBytes(diskUsage)}</span>
              </div>
            )}

            {/* Setup hook row */}
            <div className="group flex items-center gap-2 px-3 py-1.5">
              <span className="shrink-0 text-xs font-medium text-text-secondary">Setup</span>
              <div className="flex-1 flex items-center justify-end gap-1 min-w-0">
                {setupHook ? (
                  <>
                    <span className="text-xs font-mono text-text-primary truncate">{setupHook.command}</span>
                    <button
                      className="shrink-0 w-0 h-6 overflow-hidden opacity-0 bg-transparent border-none rounded-md flex items-center justify-center text-text-tertiary transition-all duration-150 ease-out group-hover:w-6 group-hover:opacity-100 hover:!text-text-primary [&>svg]:w-3.5 [&>svg]:h-3.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHookDialog(true);
                      }}
                    >
                      <Icon name="gear" />
                    </button>
                  </>
                ) : (
                  <button
                    className="bg-transparent border-none text-xs text-text-tertiary text-right p-0 transition-colors duration-150 ease-out hover:text-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHookDialog(true);
                    }}
                  >
                    + Configure
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* VM action buttons */}
          <div className="flex flex-wrap gap-2 px-3 py-2.5 border-t border-white/[0.06]">
            {vmStatus === 'NotCreated' && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleStart}
                disabled={!!activeAction}
              >
                {activeAction === 'starting' ? 'Creating\u2026' : 'Create VM'}
              </button>
            )}
            {vmStatus === 'Stopped' && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleStart}
                disabled={!!activeAction}
              >
                {activeAction === 'starting' ? 'Starting\u2026' : 'Start VM'}
              </button>
            )}
            {vmStatus === 'Running' && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleStop}
                disabled={!!activeAction}
              >
                {activeAction === 'stopping' ? 'Stopping\u2026' : 'Stop VM'}
              </button>
            )}
            <button
              className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
              onClick={handleConsole}
              disabled={!!activeAction}
            >
              VM Console
            </button>
            {(vmStatus === 'Running' || vmStatus === 'Stopped' || vmStatus === 'Broken') && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={vmStatus === 'Stopped' ? handleRecreateWithConfirm : handleRecreate}
                disabled={!!activeAction}
              >
                {activeAction === 'recreating' ? 'Recreating\u2026' : 'Recreate VM'}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
      {hookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType="sandbox-setup"
          existingHook={setupHook}
          onClose={(result) => {
            setHookDialog(false);
            if (result?.saved) {
              setSetupHook(result.hook || undefined);
              useProjectStore.getState().addToast('Sandbox setup hook saved', 'success');
            }
            onClose();
          }}
        />
      )}
    </>
  );
}
