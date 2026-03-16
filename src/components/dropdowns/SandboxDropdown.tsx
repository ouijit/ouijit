import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
        setTimeout(onClose, 150);
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

  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = (anchorRect?.bottom ?? 0) + 4;
  const right = window.innerWidth - (anchorRect?.right ?? 0);

  if (!projectPath) return null;

  return (
    <>
      {createPortal(
        <div
          ref={dropdownRef}
          className={`sandbox-dropdown${visible ? ' visible' : ''}`}
          style={{ position: 'fixed', top, right }}
        >
          <div className="sandbox-dropdown-header">Lima Sandbox</div>
          <div className="sandbox-dropdown-details">
            <div className="sandbox-dropdown-detail-row">
              <span className="sandbox-dropdown-detail-label">VM</span>
              <span
                className={`sandbox-dropdown-detail-value${vmStatus === 'Running' ? ' sandbox-dropdown-detail-value--running' : ''}`}
              >
                {VM_STATUS_LABELS[vmStatus] || vmStatus}
              </span>
            </div>
            {VM_HINTS[vmStatus] && <div className="sandbox-dropdown-vm-hint">{VM_HINTS[vmStatus]}</div>}
            {instanceName && (
              <div className="sandbox-dropdown-detail-row">
                <span className="sandbox-dropdown-detail-label">Name</span>
                <span className="sandbox-dropdown-detail-value sandbox-dropdown-detail-value--mono">
                  {instanceName}
                </span>
              </div>
            )}
            <div className="sandbox-dropdown-detail-row">
              <span className="sandbox-dropdown-detail-label">Memory</span>
              <select
                className="sandbox-dropdown-select"
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
            <div className="sandbox-dropdown-detail-row">
              <span className="sandbox-dropdown-detail-label">Disk</span>
              <select
                className="sandbox-dropdown-select"
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
              <div className="sandbox-dropdown-detail-row">
                <span className="sandbox-dropdown-detail-label">Usage</span>
                <span className="sandbox-dropdown-detail-value">{formatBytes(diskUsage)}</span>
              </div>
            )}
          </div>
          <div
            className="sandbox-dropdown-hook-row"
            onClick={() => {
              setVisible(false);
              setTimeout(() => {
                onClose();
                setHookDialog(true);
              }, 150);
            }}
          >
            <span className="sandbox-dropdown-detail-label">Setup hook</span>
            <span
              className={`sandbox-dropdown-detail-value${hasSetupHook ? ' sandbox-dropdown-detail-value--running' : ''}`}
            >
              {hasSetupHook ? 'Configured' : 'None'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 px-3 py-2.5 border-t border-white/[0.06]">
            {(vmStatus === 'Stopped' || vmStatus === 'Broken' || vmStatus === 'NotCreated') && (
              <button className="btn btn-secondary btn-sm" onClick={handleStart} disabled={loading}>
                {loading ? 'Starting\u2026' : 'Start VM'}
              </button>
            )}
            {vmStatus === 'Running' && (
              <button className="btn btn-secondary btn-sm" onClick={handleStop} disabled={loading}>
                {loading ? 'Stopping\u2026' : 'Stop VM'}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={handleConsole}>
              VM Console
            </button>
            {(vmStatus === 'Running' || vmStatus === 'Stopped' || vmStatus === 'Broken') && (
              <button className="btn btn-secondary btn-sm" onClick={handleRecreate} disabled={loading}>
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
