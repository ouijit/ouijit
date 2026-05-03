import { useState, useRef, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { useAppStore } from '../../stores/appStore';

interface NewProjectDialogProps {
  onClose: (result: { created: boolean; projectName?: string; projectPath?: string } | null) => void;
}

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useAppStore((s) => s.health);
  const inputRef = useRef<HTMLInputElement>(null);

  const gitMissing = health !== null && !health.git;
  const isValid = NAME_REGEX.test(name) && !gitMissing;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    inputRef.current?.focus();
  }, []);

  const dismiss = useCallback(
    (result: { created: boolean; projectName?: string; projectPath?: string } | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleCreate = useCallback(async () => {
    if (!isValid || creating) return;
    setError(null);
    setCreating(true);

    const result = await window.api.createProject({ name: name.trim() });
    if (result.success && result.projectPath) {
      dismiss({ created: true, projectName: name.trim(), projectPath: result.projectPath });
    } else {
      setError(result.error ?? 'Could not create project.');
      setCreating(false);
    }
  }, [name, isValid, creating, dismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isValid) {
        e.preventDefault();
        handleCreate();
      }
    },
    [isValid, handleCreate],
  );

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)}>
      <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">New Project</h2>
      {gitMissing && (
        <div
          className="mb-4 px-3 py-2 rounded-md text-xs text-text-primary"
          style={{ background: 'var(--color-git-light)', border: '1px solid var(--color-git)' }}
        >
          <strong className="font-medium">Git not found.</strong> Install via{' '}
          <code className="px-1 py-0.5 rounded bg-white/10 font-mono">xcode-select --install</code> (macOS) or your
          package manager.
        </div>
      )}
      <div className="mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="project-name">
            Name
          </label>
          <input
            ref={inputRef}
            id="project-name"
            className="w-full h-9 px-4 font-sans text-sm text-text-primary bg-background border border-border rounded-md outline-none transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
            type="text"
            placeholder="My Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={creating || gitMissing}
          />
          {error && <p className="text-xs text-error mt-1">{error}</p>}
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)]"
          onClick={() => dismiss(null)}
          disabled={creating}
        >
          Cancel
        </button>
        <button
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
          onClick={handleCreate}
          disabled={!isValid || creating}
        >
          {creating ? 'Creating\u2026' : 'Create'}
        </button>
      </div>
    </DialogOverlay>
  );
}
