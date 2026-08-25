import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { DIALOG_INPUT_CLASS, ProjectLocationField, useProjectLocation } from './ProjectLocationField';

interface NewProjectFormProps {
  onCancel: () => void;
  onCreated: (projectPath: string) => void;
}

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

/** Body and footer only — the add-project dialog owns the overlay and header. */
export function NewProjectForm({ onCancel, onCreated }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const { location, loadError, chooseLocation } = useProjectLocation();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useAppStore((s) => s.health);
  const inputRef = useRef<HTMLInputElement>(null);

  const gitMissing = health !== null && !health.git;
  const isValid = NAME_REGEX.test(name) && !gitMissing && location !== null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = useCallback(async () => {
    if (!isValid || creating) return;
    setError(null);
    setCreating(true);

    const result = await window.api.createProject({ name: name.trim(), parentDir: location ?? undefined });
    if (result.success && result.projectPath) {
      onCreated(result.projectPath);
    } else {
      setError(result.error ?? 'Could not create project.');
      setCreating(false);
    }
  }, [name, location, isValid, creating, onCreated]);

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
    <>
      {gitMissing && (
        <div
          className="mb-4 px-3 py-2 rounded-md text-xs text-text-primary"
          style={{ background: 'var(--color-git-light)', border: '1px solid var(--color-git)' }}
        >
          <strong className="font-medium">Git not found.</strong> Install via{' '}
          <code className="px-1 py-0.5 rounded bg-ink/10 font-mono">xcode-select --install</code> (macOS) or your
          package manager.
        </div>
      )}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-text-secondary" htmlFor="project-name">
            Name
          </label>
          <input
            ref={inputRef}
            id="project-name"
            className={DIALOG_INPUT_CLASS}
            type="text"
            placeholder="My Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={creating || gitMissing}
          />
        </div>
        <ProjectLocationField location={location} onChoose={chooseLocation} disabled={creating} />
        {(error ?? loadError) && <p className="text-xs text-error">{error ?? loadError}</p>}
      </div>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button className="btn-secondary" onClick={onCancel} disabled={creating}>
          Cancel
        </button>
        <button className="btn-primary" onClick={handleCreate} disabled={!isValid || creating}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </div>
    </>
  );
}
