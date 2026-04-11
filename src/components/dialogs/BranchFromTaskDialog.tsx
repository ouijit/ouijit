import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskWithWorkspace } from '../../types';
import { useProjectStore } from '../../stores/projectStore';
import { DialogOverlay } from './DialogOverlay';

interface BranchFromTaskDialogProps {
  projectPath: string;
  parentTask: TaskWithWorkspace;
  onClose: (created: boolean) => void;
}

export function BranchFromTaskDialog({ projectPath, parentTask, onClose }: BranchFromTaskDialogProps) {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  // Clear dismiss timeout on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const dismiss = useCallback(
    (created: boolean) => {
      setVisible(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onClose(created), 200);
    },
    [onClose],
  );

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const result = await window.api.task.createFromTask(projectPath, parentTask.taskNumber, name || undefined);
    setSubmitting(false);
    if (result.success) {
      dismiss(true);
    } else {
      useProjectStore.getState().addToast(result.error || 'Failed to create task', 'error');
    }
  }, [projectPath, parentTask.taskNumber, name, submitting, dismiss]);

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(false)} maxWidth={420}>
      <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">Branch from #{parentTask.taskNumber}</h2>
      <p className="text-xs text-text-secondary/70 text-center mb-4">
        New task will branch from <code className="font-mono">{parentTask.branch}</code>
      </p>
      <input
        ref={inputRef}
        type="text"
        className="w-full px-3 py-2 rounded-lg bg-black/20 border border-border text-sm text-text-primary font-mono outline-none focus:border-accent"
        placeholder="Task name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') dismiss(false);
        }}
      />
      <div className="flex gap-2 justify-end mt-4">
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)]"
          onClick={() => dismiss(false)}
        >
          Cancel
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
          onClick={handleSubmit}
          disabled={submitting}
        >
          Create
        </button>
      </div>
    </DialogOverlay>
  );
}
