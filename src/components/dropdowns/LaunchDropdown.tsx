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

  // Click outside (disabled while hook dialog is open)
  useEffect(() => {
    if (hookDialog) return;
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
  }, [onClose, anchorRef, hookDialog]);

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
          className="min-w-[240px] max-w-[272px] bg-surface border border-border rounded-md shadow-lg z-[1000] overflow-hidden transition-opacity duration-150 ease-out"
          style={{
            ...floatingStyles,
            opacity: ready ? 1 : 0,
          }}
        >
          <div className="text-[13px] text-text-tertiary px-3 pt-2 pb-1 uppercase tracking-wide">Scripts</div>
          <div className="flex flex-col pb-1">
            {HOOK_ORDER.map(({ type, label, hint }, i) => {
              const hook = hooks[type];
              const isLast = i === HOOK_ORDER.length - 1;
              return (
                <div
                  key={type}
                  className="flex flex-col"
                  style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255, 255, 255, 0.06)' }}
                >
                  <div className="group flex items-center gap-2 px-3 py-1.5">
                    <span className="shrink-0 w-[52px] text-xs font-medium text-text-secondary">{label}</span>
                    <div className="flex-1 flex items-center justify-end gap-1 min-w-0">
                      {hook && <span className="text-xs font-mono text-text-primary truncate">{hook.command}</span>}
                      {hook ? (
                        <button
                          className="shrink-0 w-0 h-6 overflow-hidden opacity-0 bg-transparent border-none rounded-md flex items-center justify-center text-text-tertiary transition-all duration-150 ease-out group-hover:w-6 group-hover:opacity-100 hover:!text-text-primary [&>svg]:w-3.5 [&>svg]:h-3.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConfigure(type);
                          }}
                        >
                          <Icon name="gear" />
                        </button>
                      ) : (
                        <button
                          className="bg-transparent border-none text-xs text-text-tertiary text-right p-0 transition-colors duration-150 ease-out hover:text-accent"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleConfigure(type);
                          }}
                        >
                          + Configure
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-[13px] text-text-tertiary leading-snug px-3 pb-2">{hint}</div>
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
