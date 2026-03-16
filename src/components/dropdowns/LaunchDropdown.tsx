import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import type { HookType, ScriptHook } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { HookConfigDialog } from '../dialogs/HookConfigDialog';
import { Icon } from '../terminal/Icon';

const HOOK_ORDER: { type: HookType; label: string; hint: string }[] = [
  { type: 'run', label: 'Run', hint: 'Runs when you click Run' },
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
  const [ready, setReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (anchorRef.current) refs.setReference(anchorRef.current);
  }, [anchorRef, refs]);

  // Load hooks
  useEffect(() => {
    if (!projectPath) return;
    window.api.hooks.get(projectPath).then((h) => {
      setHooks(h as Record<string, ScriptHook | undefined>);
      requestAnimationFrame(() => setReady(true));
    });
  }, [projectPath]);

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

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
          ref={(node) => {
            (dropdownRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            refs.setFloating(node);
          }}
          className="min-w-[200px] max-w-[280px] bg-surface border border-border rounded-md shadow-lg z-[1000] overflow-hidden transition-opacity duration-150 ease-out"
          style={{
            ...floatingStyles,
            opacity: ready ? 1 : 0,
          }}
        >
          <div className="text-[13px] text-text-tertiary px-3 pt-2 pb-1 uppercase tracking-wide">Scripts</div>
          <div className="flex flex-col">
            {HOOK_ORDER.map(({ type, label, hint }) => {
              const hook = hooks[type];
              return (
                <div key={type} className="px-3 py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-text-primary">{label}</span>
                      {hook && <span className="text-xs font-mono text-text-tertiary truncate">{hook.command}</span>}
                    </div>
                    <button
                      className="text-xs text-text-tertiary hover:text-accent transition-colors shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfigure(type);
                      }}
                    >
                      {hook ? <Icon name="gear" /> : '+ Configure'}
                    </button>
                  </div>
                  <div className="text-[11px] text-text-tertiary mt-0.5">{hint}</div>
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
