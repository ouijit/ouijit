import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { addProjectTerminal } from '../terminal/terminalActions';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';

const VM_STATUS_LABELS: Record<string, string> = {
  Running: 'Running',
  Stopped: 'Stopped',
  Broken: 'Broken',
  NotCreated: 'Not created',
  Unavailable: 'Unavailable',
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
  const [vmStatus, setVmStatus] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [diskUsage, setDiskUsage] = useState<number | null>(null);
  const [memoryGiB, setMemoryGiB] = useState(4);
  const [diskGiB, setDiskGiB] = useState(100);
  const [hasSetupHook, setHasSetupHook] = useState(false);
  const [hookDialog, setHookDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Floating UI positioning
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
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
      setHasSetupHook(!!(hooks as any)['sandbox-setup']);
    })();
  }, [projectPath]);

  // Click outside
  useEffect(() => {
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
  }, [onClose, anchorRef]);

  const handleStart = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    onClose();
    window.api.lima.start(projectPath).catch(() => {});
    // Poll until running (timeout 5 min)
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(projectPath);
        if (s.vmStatus === 'Running') {
          clearInterval(poll);
          setVmStatus('Running');
          setLoading(false);
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    setTimeout(() => {
      clearInterval(poll);
      setLoading(false);
    }, 300_000);
  }, [projectPath, onClose]);

  const handleStop = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    await window.api.lima.stop(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setLoading(false);
    onClose();
  }, [projectPath, onClose]);

  const handleRecreate = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    await window.api.lima.recreate(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setLoading(false);
    onClose();
  }, [projectPath, onClose]);

  const handleConsole = useCallback(() => {
    if (!projectPath) return;
    onClose();
    addProjectTerminal(
      projectPath,
      { name: 'VM Console', command: '', source: 'custom', priority: 0 },
      { sandboxed: true },
    );
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
          className="min-w-[240px] max-w-[280px] bg-surface border border-border rounded-md shadow-lg z-[1000] overflow-hidden"
          style={floatingStyles}
        >
          <div className="text-[13px] text-text-tertiary px-3 pt-2 pb-1 uppercase tracking-wide">Lima Sandbox</div>
          <div className="flex flex-col gap-0.5 px-3 py-1">
            <div className="flex items-center justify-between text-xs py-0.5">
              <span className="font-medium text-text-secondary">VM</span>
              <span className={vmStatus === 'Running' ? 'text-[#0a84ff]' : 'text-text-secondary'}>
                {VM_STATUS_LABELS[vmStatus] || vmStatus}
              </span>
            </div>
            {VM_HINTS[vmStatus] && (
              <div className="text-[13px] text-text-tertiary leading-snug pt-0.5">{VM_HINTS[vmStatus]}</div>
            )}
            {instanceName && (
              <div className="flex items-center justify-between text-xs py-0.5">
                <span className="font-medium text-text-secondary">Name</span>
                <span className="text-text-secondary font-mono">{instanceName}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs py-0.5">
              <span className="font-medium text-text-secondary">Memory</span>
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
            <div className="flex items-center justify-between text-xs py-0.5">
              <span className="font-medium text-text-secondary">Disk</span>
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
              <div className="flex items-center justify-between text-xs py-0.5">
                <span className="font-medium text-text-secondary">Usage</span>
                <span className="text-text-secondary">{formatBytes(diskUsage)}</span>
              </div>
            )}
          </div>
          <div
            className="flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-white/[0.04] transition-colors"
            onClick={() => {
              onClose();
              setHookDialog(true);
            }}
          >
            <span className="text-xs font-medium text-text-secondary">Setup hook</span>
            <span className={`text-xs ${hasSetupHook ? 'text-[#0a84ff]' : 'text-text-secondary'}`}>
              {hasSetupHook ? 'Configured' : 'None'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 px-3 py-2.5 border-t border-white/[0.06]">
            {(vmStatus === 'Stopped' || vmStatus === 'Broken' || vmStatus === 'NotCreated') && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleStart}
                disabled={loading}
              >
                {loading ? 'Starting\u2026' : 'Start VM'}
              </button>
            )}
            {vmStatus === 'Running' && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleStop}
                disabled={loading}
              >
                {loading ? 'Stopping\u2026' : 'Stop VM'}
              </button>
            )}
            <button
              className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all"
              onClick={handleConsole}
            >
              VM Console
            </button>
            {(vmStatus === 'Running' || vmStatus === 'Stopped' || vmStatus === 'Broken') && (
              <button
                className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-background-secondary border border-border rounded-md hover:bg-background-tertiary hover:text-text-primary transition-all disabled:opacity-50"
                onClick={handleRecreate}
                disabled={loading}
              >
                {loading ? 'Recreating\u2026' : 'Recreate VM'}
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
          onClose={(result) => {
            setHookDialog(false);
            if (result?.saved) {
              setHasSetupHook(!!result.hook);
              useProjectStore.getState().addToast('Sandbox setup hook saved', 'success');
            }
          }}
        />
      )}
    </>
  );
}
