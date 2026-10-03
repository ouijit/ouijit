import { useState, useRef, useEffect, useCallback } from 'react';
import type { Script } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { DialogOverlay } from './DialogOverlay';
import { Checkbox } from '../ui/Checkbox';

interface ScriptConfigDialogProps {
  projectPath: string;
  onClose: (script: Script | null) => void;
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary';

export function ScriptConfigDialog({ projectPath, onClose }: ScriptConfigDialogProps) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [restartIfRunning, setRestartIfRunning] = useState(false);
  const [visible, setVisible] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    nameRef.current?.focus();
  }, []);

  const dismiss = useCallback(
    (script: Script | null) => {
      setVisible(false);
      setTimeout(() => onClose(script), 200);
    },
    [onClose],
  );

  const isValid = name.trim() !== '' && command.trim() !== '';

  const handleSave = useCallback(async () => {
    if (!isValid) return;
    const result = await window.api.scripts.save(projectPath, {
      id: crypto.randomUUID(),
      name: name.trim(),
      command: command.trim(),
      sortOrder: 0,
      restartIfRunning,
    });
    if (!result.success || !result.script) {
      useProjectStore.getState().addToast('Failed to save script', 'error');
      return;
    }
    await useProjectStore.getState().loadScripts(projectPath);
    dismiss(result.script);
  }, [isValid, projectPath, name, command, restartIfRunning, dismiss]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleSave();
  };

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">New Script</h2>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="script-name">
            Name
          </label>
          <input
            ref={nameRef}
            id="script-name"
            className={INPUT_CLASS}
            placeholder="Test"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="script-command">
            Command
          </label>
          <input
            id="script-command"
            className={`${INPUT_CLASS} font-mono`}
            placeholder="npm test"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Checkbox
          checked={restartIfRunning}
          onChange={setRestartIfRunning}
          label="Restart if it's already running in the task"
        />
      </div>

      <div className="flex gap-2 justify-end mt-4">
        <button className="btn-secondary" onClick={() => dismiss(null)}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!isValid} onClick={() => void handleSave()}>
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}
