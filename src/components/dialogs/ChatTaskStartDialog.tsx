import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { getProjectConfig, loadProjectConfig, saveTaskOpening } from '../../stores/projectDataStore';
import { parseTaskOpening, type TaskOpening } from '../../chat/preferences';
import { fillHookVars, taskHookVars } from '../../utils/hookEnvVars';
import { useAutoResize } from '../../hooks/useAutoResize';
import { DialogOverlay } from './DialogOverlay';
import { HookEnvVars } from './HookEnvVars';

const FIELD_CLASS =
  'w-full px-3 py-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary';

const SAMPLE_TASK = {
  taskNumber: 12,
  name: 'Add a dark mode toggle',
  prompt: 'Add a switch to Settings that changes between the light and dark themes.',
  status: 'todo' as const,
  order: 0,
  createdAt: '',
};

function Field({
  id,
  label,
  description,
  value,
  onChange,
  rows = 1,
  autoFocus = false,
}: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  autoFocus?: boolean;
}) {
  const autoResize = useAutoResize();
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-text-secondary" htmlFor={id}>
        {label}
      </label>
      <p className="text-sm text-text-secondary leading-snug -mt-2 mb-4">{description}</p>
      <textarea
        id={id}
        className={FIELD_CLASS}
        style={{ transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out' }}
        placeholder="None"
        value={value}
        rows={rows}
        autoFocus={autoFocus}
        onChange={(e) => {
          onChange(e.target.value);
          autoResize(e);
        }}
      />
    </div>
  );
}

/** What a project's task chats run first and are sent first, used in place of its start and continue hooks where tasks open in chat. */
export function ChatTaskStartDialog({ projectPath, onClose }: { projectPath: string; onClose: () => void }) {
  const [values, setValues] = useState<TaskOpening>(
    () => getProjectConfig(projectPath)?.taskOpening ?? parseTaskOpening(null),
  );
  const edited = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (getProjectConfig(projectPath)) return;
    void loadProjectConfig(projectPath).then(() => {
      const loaded = getProjectConfig(projectPath)?.taskOpening;
      if (loaded && !edited.current) setValues(loaded);
    });
  }, [projectPath]);

  const set = (patch: Partial<TaskOpening>) => {
    edited.current = true;
    setValues((current) => ({ ...current, ...patch }));
  };

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  const save = useCallback(async () => {
    if (!(await saveTaskOpening(projectPath, values))) {
      useProjectStore.getState().addToast('Could not save', 'error');
      return;
    }
    useProjectStore.getState().addToast('Hooks saved', 'success');
    dismiss();
  }, [projectPath, values, dismiss]);

  const sample = fillHookVars(
    values.firstMessage,
    taskHookVars({
      projectPath,
      worktree: { path: `${projectPath}-worktrees/T-12`, branch: 'add-dark-mode-toggle-12' },
      name: SAMPLE_TASK.name,
      task: SAMPLE_TASK,
    }),
  ).trim();

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">Start Hook</h2>

      <div className="mb-6 flex flex-col gap-4">
        <Field
          id="chat-setup"
          label="Setup"
          description="Runs before the task chat starts"
          value={values.setup}
          onChange={(setup) => set({ setup })}
          autoFocus
        />
        <div className="flex flex-col gap-1">
          <Field
            id="chat-first-message"
            label="First message"
            description="Sent to the task chat once Setup succeeds"
            value={values.firstMessage}
            onChange={(firstMessage) => set({ firstMessage })}
            rows={3}
          />
          <div
            data-testid="first-message-preview"
            className="mt-1.5 rounded-md bg-ink/[0.04] px-3 py-2 text-[13px] text-text-secondary whitespace-pre-wrap break-words"
          >
            {sample || <span className="text-text-tertiary">Nothing is sent; the chat waits for you.</span>}
          </div>
        </div>
        <HookEnvVars />
      </div>

      <div className="flex gap-2 justify-end">
        <button className="btn-secondary" onClick={dismiss}>
          Cancel
        </button>
        <button className="btn-primary" onClick={() => void save()}>
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}
