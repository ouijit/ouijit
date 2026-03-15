import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { HookType, ScriptHook } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { Icon } from '../terminal/Icon';

const HOOK_ORDER: { type: HookType; label: string; hint: string }[] = [
  { type: 'start', label: 'Start', hint: 'Runs when a task moves from To Do to In Progress' },
  { type: 'continue', label: 'Continue', hint: 'Runs when reopening an In Progress task' },
  { type: 'run', label: 'Run', hint: 'Runs when you click Run' },
  { type: 'review', label: 'Review', hint: 'Runs when a task moves to In Review' },
  { type: 'cleanup', label: 'Cleanup', hint: 'Runs when a task moves to Done' },
  { type: 'editor', label: 'Editor', hint: 'Opens the task worktree in your editor' },
];

interface LaunchDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function LaunchDropdown({ anchorRef, onClose }: LaunchDropdownProps) {
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const [hooks, setHooks] = useState<Record<string, ScriptHook | undefined>>({});
  const [hookDialog, setHookDialog] = useState<{ hookType: HookType; existing?: ScriptHook } | null>(null);
  const [visible, setVisible] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load hooks
  useEffect(() => {
    if (!projectPath) return;
    window.api.hooks.get(projectPath).then((h) => {
      setHooks(h as Record<string, ScriptHook | undefined>);
    });
  }, [projectPath]);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        setVisible(false);
        setTimeout(onClose, 150);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Position below anchor
  const anchorRect = anchorRef.current?.getBoundingClientRect();
  const top = (anchorRect?.bottom ?? 0) + 4;
  const right = window.innerWidth - (anchorRect?.right ?? 0);

  const handleConfigure = useCallback(
    (hookType: HookType) => {
      const existing = hooks[hookType];
      setHookDialog({ hookType, existing });
    },
    [hooks],
  );

  const handleHookDialogClose = useCallback(
    (result: { saved: boolean } | null) => {
      setHookDialog(null);
      if (result?.saved && projectPath) {
        // Reload hooks
        window.api.hooks.get(projectPath).then((h) => {
          setHooks(h as Record<string, ScriptHook | undefined>);
        });
      }
    },
    [projectPath],
  );

  if (!projectPath) return null;

  return (
    <>
      {createPortal(
        <div
          ref={dropdownRef}
          className={`project-launch-dropdown${visible ? ' visible' : ''}`}
          style={{ position: 'fixed', top, right }}
        >
          <div className="launch-dropdown-header">Scripts</div>
          <div className="hooks-container">
            {HOOK_ORDER.map(({ type, label, hint }) => {
              const hook = hooks[type];
              return (
                <div key={type} className="hook-row-wrapper">
                  <div className="hook-row">
                    <div className="hook-row-left">
                      <span className="hook-name">{label}</span>
                      {hook && <span className="hook-command-preview">{hook.command}</span>}
                    </div>
                    <div className="hook-row-right">
                      <button
                        className="hook-configure-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfigure(type);
                        }}
                      >
                        {hook ? <Icon name="gear" /> : '+ Configure'}
                      </button>
                    </div>
                  </div>
                  <div className="hook-hint">{hint}</div>
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
      {hookDialog && (
        <HookConfigDialog
          projectPath={projectPath}
          hookType={hookDialog.hookType}
          existingHook={hookDialog.existing}
          onClose={handleHookDialogClose}
        />
      )}
    </>
  );
}
