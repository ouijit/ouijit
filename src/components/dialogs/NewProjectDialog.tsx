import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface NewProjectDialogProps {
  onClose: (result: { created: boolean; projectName?: string; projectPath?: string } | null) => void;
}

const NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/;

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isValid = NAME_REGEX.test(name);

  // Animate in
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
    setCreating(true);

    const result = await window.api.createProject({ name: name.trim() });
    if (result.success && result.projectPath) {
      dismiss({ created: true, projectName: name.trim(), projectPath: result.projectPath });
    } else {
      setCreating(false);
    }
  }, [name, isValid, creating, dismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && isValid) {
        e.preventDefault();
        handleCreate();
      } else if (e.key === 'Escape') {
        dismiss(null);
      }
    },
    [isValid, handleCreate, dismiss],
  );

  return createPortal(
    <div
      className={`fixed inset-0 flex justify-center z-[10001] p-10 overflow-y-auto transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
    >
      <div
        className={`bg-surface rounded-[32px] shadow-lg max-w-[400px] w-[90%] p-6 border border-border overflow-hidden shrink-0 my-auto ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2.5'}`}
        style={{ transition: 'opacity 200ms ease-out, transform 200ms ease-out' }}
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4 text-center">New Project</h2>
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
              disabled={creating}
            />
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
      </div>
    </div>,
    document.body,
  );
}
