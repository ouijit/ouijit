import { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';

interface NewProjectFormProps {
  onCancel: () => void;
  onCreated: (projectPath: string) => void;
}

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

/** Body and footer only — the add-project dialog owns the overlay and header. */
export function NewProjectForm({ onCancel, onCreated }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const health = useAppStore((s) => s.health);
  const inputRef = useRef<HTMLInputElement>(null);

  const gitMissing = health !== null && !health.git;
  const isValid = NAME_REGEX.test(name) && !gitMissing && location !== null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The current default projects folder — whatever folder the project ends up
  // created in is persisted as the new default by the main process.
  useEffect(() => {
    let cancelled = false;
    window.api
      .getDefaultProjectsFolder()
      .then((folder) => {
        if (!cancelled) setLocation(folder);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the projects folder. Choose a location.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChooseLocation = useCallback(async () => {
    const result = await window.api.showFolderPicker({
      title: 'Choose Projects Folder',
      buttonLabel: 'Choose',
      defaultPath: location ?? undefined,
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setLocation(result.filePaths[0]);
    }
  }, [location]);

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
            className="w-full h-9 px-4 font-sans text-sm text-text-primary bg-background border border-border rounded-md outline-none transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary"
            type="text"
            placeholder="My Project"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={creating || gitMissing}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text-secondary">Location</span>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 min-w-0 h-9 px-4 flex items-center text-xs font-mono text-text-secondary bg-background border border-border rounded-md truncate"
              title={location ?? undefined}
            >
              <span className="truncate">{location ?? '…'}</span>
            </div>
            <button className="btn-secondary shrink-0" onClick={handleChooseLocation} disabled={creating}>
              Choose…
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
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
