import { useState, useRef, useEffect } from 'react';
import type { Script } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { DialogOverlay } from './DialogOverlay';
import { DIALOG_INPUT_CLASS, DIALOG_MONO_INPUT_CLASS } from './dialogStyles';
import { Checkbox } from '../ui/Checkbox';
import { scriptFromDraft } from '../scripts/scriptFromDraft';

interface ScriptConfigDialogProps {
  projectPath: string;
  /** Edits this script in place; without it the dialog creates one. */
  existing?: Script;
  onClose: (script: Script | null) => void;
}

export function ScriptConfigDialog({ projectPath, existing, onClose }: ScriptConfigDialogProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [command, setCommand] = useState(existing?.command ?? '');
  const [restartIfRunning, setRestartIfRunning] = useState(existing?.restartIfRunning ?? false);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    nameRef.current?.focus();
  }, []);

  const draft = scriptFromDraft({ name, command, restartIfRunning }, existing);

  const dismiss = (script: Script | null) => {
    setVisible(false);
    setTimeout(() => onClose(script), 200);
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const saved = await useProjectStore.getState().saveScript(projectPath, draft);
    if (saved) dismiss(saved);
    else setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleSave();
  };

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">
        {existing ? 'Edit Script' : 'New Script'}
      </h2>

      <div className="mb-6 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="script-name">
            Name
          </label>
          <input
            ref={nameRef}
            id="script-name"
            className={DIALOG_INPUT_CLASS}
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
            className={DIALOG_MONO_INPUT_CLASS}
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
        <button className="btn-primary" disabled={!draft || saving} onClick={() => void handleSave()}>
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}
