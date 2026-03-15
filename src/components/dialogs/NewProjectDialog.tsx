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
      className={`modal-overlay${visible ? ' modal-overlay--visible' : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
    >
      <div className={`dialog${visible ? ' dialog--visible' : ''}`}>
        <h2 className="dialog-title">New Project</h2>
        <div className="new-project-form">
          <div className="form-group">
            <label className="form-label" htmlFor="project-name">
              Name
            </label>
            <input
              ref={inputRef}
              id="project-name"
              className="form-input"
              type="text"
              placeholder="My Project"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={creating}
            />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-secondary" onClick={() => dismiss(null)} disabled={creating}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!isValid || creating}>
            {creating ? 'Creating\u2026' : 'Create'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
