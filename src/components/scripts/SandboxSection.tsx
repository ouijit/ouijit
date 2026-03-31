import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { addProjectTerminal } from '../terminal/terminalActions';

const VM_STATUS_LABELS: Record<string, string> = {
  Running: 'Running',
  Stopped: 'Stopped',
  Broken: 'Broken',
  NotCreated: 'Not created',
};

interface SandboxSectionProps {
  projectPath: string;
}

export function SandboxSection({ projectPath }: SandboxSectionProps) {
  const sandboxStarting = useAppStore((s) => s.sandboxStarting);
  const [vmStatus, setVmStatus] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [activeAction, setActiveAction] = useState<'starting' | 'stopping' | 'recreating' | null>(null);

  // YAML editor state
  const [mergedYaml, setMergedYaml] = useState('');
  const [userYaml, setUserYaml] = useState('');
  const [editorValue, setEditorValue] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [yamlError, setYamlError] = useState<string | null>(null);
  const [showRecreatePrompt, setShowRecreatePrompt] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load status + config
  useEffect(() => {
    (async () => {
      const [status, merged, raw] = await Promise.all([
        window.api.lima.status(projectPath),
        window.api.lima.getMergedYaml(projectPath),
        window.api.lima.getYaml(projectPath),
      ]);
      setVmStatus(status.vmStatus);
      setInstanceName(status.instanceName || '');
      setMergedYaml(merged);
      setUserYaml(raw);
      setEditorValue(raw);
    })();
  }, [projectPath]);

  // Poll VM status
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(projectPath);
        setVmStatus(s.vmStatus);
        if (s.vmStatus === 'Running') useAppStore.getState().setSandboxStarting(false);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [projectPath]);

  const handleEditorChange = useCallback(
    (value: string) => {
      setEditorValue(value);
      setIsDirty(value !== userYaml);
      setYamlError(null);
    },
    [userYaml],
  );

  const handleSave = useCallback(async () => {
    const result = await window.api.lima.setYaml(projectPath, editorValue);
    if (!result.success) {
      setYamlError(result.error || 'Failed to save');
      return;
    }
    setUserYaml(editorValue);
    setIsDirty(false);
    setYamlError(null);

    // Refresh merged view
    const merged = await window.api.lima.getMergedYaml(projectPath);
    setMergedYaml(merged);

    // Prompt to recreate if VM exists
    if (vmStatus === 'Running' || vmStatus === 'Stopped') {
      setShowRecreatePrompt(true);
    }
  }, [projectPath, editorValue, vmStatus]);

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
    setShowRecreatePrompt(false);
    setActiveAction('recreating');
    useAppStore.getState().setSandboxStarting(true);
    await window.api.lima.recreate(projectPath);
    const status = await window.api.lima.status(projectPath);
    setVmStatus(status.vmStatus);
    setActiveAction(null);
  }, [projectPath]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;

        if (e.shiftKey) {
          // Shift+Tab: dedent current line(s)
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          const before = value.substring(0, lineStart);
          const line = value.substring(lineStart);
          if (line.startsWith('  ')) {
            const newValue = before + line.substring(2);
            handleEditorChange(newValue);
            requestAnimationFrame(() => {
              textarea.selectionStart = Math.max(start - 2, lineStart);
              textarea.selectionEnd = Math.max(end - 2, lineStart);
            });
          }
        } else {
          // Tab: insert 2 spaces (YAML standard)
          const newValue = value.substring(0, start) + '  ' + value.substring(end);
          handleEditorChange(newValue);
          requestAnimationFrame(() => {
            textarea.selectionStart = start + 2;
            textarea.selectionEnd = start + 2;
          });
        }
      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isDirty) handleSave();
      }
    },
    [handleEditorChange, isDirty, handleSave],
  );

  const [showMerged, setShowMerged] = useState(false);
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
      </div>

      {/* YAML config editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium text-text-secondary">Configuration</span>
          <div className="flex items-center gap-2">
            <button
              className={`text-[10px] px-1.5 py-0.5 rounded ${showMerged ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
              onClick={() => setShowMerged(!showMerged)}
            >
              {showMerged ? 'Edit' : 'Merged'}
            </button>
            {isDirty && (
              <button
                className="text-[10px] px-2 py-0.5 rounded bg-[#0a84ff]/20 text-[#0a84ff] hover:bg-[#0a84ff]/30 transition-colors"
                onClick={handleSave}
              >
                Save
              </button>
            )}
          </div>
        </div>

        {showMerged ? (
          <textarea
            className="w-full min-h-[400px] text-[13px] leading-5 font-mono bg-black/30 border border-white/10 rounded-md p-4 text-text-secondary resize-y outline-none tabular-nums"
            value={mergedYaml}
            readOnly
            spellCheck={false}
          />
        ) : (
          <textarea
            ref={textareaRef}
            className="w-full min-h-[400px] text-[13px] leading-5 font-mono bg-black/30 border border-white/10 rounded-md p-4 text-text-primary resize-y outline-none focus:border-white/20 tabular-nums"
            value={editorValue}
            onChange={(e) => handleEditorChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Loading configuration..."
          />
        )}

        {yamlError && <p className="text-[11px] text-red-400 px-1">{yamlError}</p>}
      </div>

      {/* Recreate prompt */}
      {showRecreatePrompt && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-text-secondary">Config changed. Recreate VM now?</span>
          <button
            className="text-[10px] px-2 py-0.5 rounded bg-[#0a84ff]/20 text-[#0a84ff] hover:bg-[#0a84ff]/30"
            onClick={handleRecreate}
          >
            Yes
          </button>
          <button
            className="text-[10px] px-2 py-0.5 rounded text-text-secondary hover:text-text-primary"
            onClick={() => setShowRecreatePrompt(false)}
          >
            Later
          </button>
        </div>
      )}

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
            onClick={() => {
              if (confirm('This will delete the current VM and all its data, then create a fresh one.')) {
                handleRecreate();
              }
            }}
            disabled={!!activeAction}
          >
            {activeAction === 'recreating' ? 'Recreating\u2026' : 'Recreate VM'}
          </button>
        )}
      </div>
    </div>
  );
}
