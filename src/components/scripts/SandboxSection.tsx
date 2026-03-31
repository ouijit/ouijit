import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { addProjectTerminal } from '../terminal/terminalActions';
import { HookList } from './HookList';
import type { HookEntry } from './HookList';

const SANDBOX_HOOK: HookEntry[] = [
  { type: 'sandbox-setup', label: 'Setup', description: 'Runs inside the VM before each command' },
];

const VM_STATUS_LABELS: Record<string, string> = {
  Running: 'Running',
  Stopped: 'Stopped',
  Broken: 'Broken',
  NotCreated: 'Not created',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 10) / 10} ${units[i]}`;
}

interface SandboxSectionProps {
  projectPath: string;
}

export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const sandboxStarting = useAppStore((s) => s.sandboxStarting);
  const [vmStatus, setVmStatus] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [diskUsage, setDiskUsage] = useState<number | null>(null);
  const [memoryGiB, setMemoryGiB] = useState(4);
  const [diskGiB, setDiskGiB] = useState(100);
  const [activeAction, setActiveAction] = useState<'starting' | 'stopping' | 'recreating' | null>(null);

  // Load status + config
  useEffect(() => {
    (async () => {
      const [status, config] = await Promise.all([
        window.api.lima.status(projectPath),
        window.api.lima.getConfig(projectPath),
      ]);
      setVmStatus(status.vmStatus);
      setInstanceName(status.instanceName || '');
      setDiskUsage(status.disk ?? null);
      setMemoryGiB(config.memoryGiB);
      setDiskGiB(config.diskGiB);
    })();
  }, [projectPath]);

  // Poll VM status
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(projectPath);
        setVmStatus(s.vmStatus);
        if (s.disk != null) setDiskUsage(s.disk);
        if (s.vmStatus === 'Running') useAppStore.getState().setSandboxStarting(false);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [projectPath]);

  const handleStart = useCallback(async () => {
    setActiveAction('starting');
    useAppStore.getState().setSandboxStarting(true);
    window.api.lima.start(projectPath).catch(() => {});
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
  }, [projectPath]);

  const handleStop = useCallback(async () => {
    setActiveAction('stopping');
    await window.api.lima.stop(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setActiveAction(null);
  }, [projectPath]);

  const handleRecreate = useCallback(async () => {
    setActiveAction('recreating');
    useAppStore.getState().setSandboxStarting(true);
    await window.api.lima.recreate(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setActiveAction(null);
  }, [projectPath]);

  const handleRecreateWithConfirm = useCallback(() => {
    if (confirm('This will delete the current VM and all its data, then create a fresh one.')) {
      handleRecreate();
    }
  }, [handleRecreate]);

  const handleConsole = useCallback(() => {
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
    useProjectStore.getState().setActivePanel('terminals');
  }, [projectPath]);

  const handleMemoryChange = useCallback(
    async (val: number) => {
      setMemoryGiB(val);
      await window.api.lima.setConfig(projectPath, { memoryGiB: val, diskGiB });
    },
    [projectPath, diskGiB],
  );

  const handleDiskChange = useCallback(
    async (val: number) => {
      setDiskGiB(val);
      await window.api.lima.setConfig(projectPath, { memoryGiB, diskGiB: val });
    },
    [projectPath, memoryGiB],
  );

  const statusLabel = sandboxStarting ? 'Starting\u2026' : VM_STATUS_LABELS[vmStatus] || vmStatus;
  const statusColor = vmStatus === 'Running' && !sandboxStarting ? 'text-[#0a84ff]' : 'text-text-primary';

  return (
    <div className="space-y-4">
      {/* VM info rows */}
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-center px-1">
        <span className="text-xs font-medium text-text-secondary">VM Status</span>
        <span className={`text-xs ${statusColor}`}>{statusLabel}</span>

        {instanceName && (
          <>
            <span className="text-xs font-medium text-text-secondary">Instance</span>
            <span className="text-xs font-mono text-text-primary">{instanceName}</span>
          </>
        )}

        <span className="text-xs font-medium text-text-secondary">Memory</span>
        <select
          className="text-xs text-text-primary bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 outline-none w-fit"
          value={memoryGiB}
          onChange={(e) => handleMemoryChange(parseInt(e.target.value, 10))}
        >
          {[2, 4, 8, 16].map((v) => (
            <option key={v} value={v}>
              {v} GiB
            </option>
          ))}
        </select>

        <span className="text-xs font-medium text-text-secondary">Disk</span>
        <select
          className="text-xs text-text-primary bg-white/[0.06] border border-white/10 rounded px-1.5 py-0.5 outline-none w-fit"
          value={diskGiB}
          onChange={(e) => handleDiskChange(parseInt(e.target.value, 10))}
        >
          {[50, 100, 200].map((v) => (
            <option key={v} value={v}>
              {v} GiB
            </option>
          ))}
        </select>

        {vmStatus === 'Running' && diskUsage != null && (
          <>
            <span className="text-xs font-medium text-text-secondary">Disk Usage</span>
            <span className="text-xs text-text-primary">{formatBytes(diskUsage)}</span>
          </>
        )}
      </div>

      {/* Setup hook — dark card */}
      <HookList projectPath={projectPath} hooks={SANDBOX_HOOK} />

      {/* VM action buttons */}
      <div className="flex flex-wrap gap-2 mt-3">
        {vmStatus === 'NotCreated' && (
          <button
            className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-white/[0.06] border border-white/10 rounded-md hover:bg-white/[0.1] hover:text-text-primary transition-all disabled:opacity-50"
            onClick={handleStart}
            disabled={!!activeAction}
          >
            {activeAction === 'starting' ? 'Creating\u2026' : 'Create VM'}
          </button>
        )}
        {vmStatus === 'Stopped' && (
          <button
            className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-white/[0.06] border border-white/10 rounded-md hover:bg-white/[0.1] hover:text-text-primary transition-all disabled:opacity-50"
            onClick={handleStart}
            disabled={!!activeAction}
          >
            {activeAction === 'starting' ? 'Starting\u2026' : 'Start VM'}
          </button>
        )}
        {vmStatus === 'Running' && (
          <button
            className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-white/[0.06] border border-white/10 rounded-md hover:bg-white/[0.1] hover:text-text-primary transition-all disabled:opacity-50"
            onClick={handleStop}
            disabled={!!activeAction}
          >
            {activeAction === 'stopping' ? 'Stopping\u2026' : 'Stop VM'}
          </button>
        )}
        <button
          className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-white/[0.06] border border-white/10 rounded-md hover:bg-white/[0.1] hover:text-text-primary transition-all disabled:opacity-50"
          onClick={handleConsole}
          disabled={!!activeAction}
        >
          VM Console
        </button>
        {(vmStatus === 'Running' || vmStatus === 'Stopped' || vmStatus === 'Broken') && (
          <button
            className="px-3 py-1.5 text-xs font-medium text-text-secondary bg-white/[0.06] border border-white/10 rounded-md hover:bg-white/[0.1] hover:text-text-primary transition-all disabled:opacity-50"
            onClick={vmStatus === 'Stopped' ? handleRecreateWithConfirm : handleRecreate}
            disabled={!!activeAction}
          >
            {activeAction === 'recreating' ? 'Recreating\u2026' : 'Recreate VM'}
          </button>
        )}
      </div>
    </div>
  );
}
