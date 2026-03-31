import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
import type { Script, RunnerScript } from '../../types';
import { Icon } from '../terminal/Icon';

interface RunScriptDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  projectPath: string;
  hasRunHook: boolean;
  onSelectScript: (script: RunnerScript) => void;
  onSelectRunHook: () => void;
  onClose: () => void;
}

export function RunScriptDropdown({
  anchorRef,
  projectPath,
  hasRunHook,
  onSelectScript,
  onSelectRunHook,
  onClose,
}: RunScriptDropdownProps) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [ready, setReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Sync anchor ref
  useEffect(() => {
    if (anchorRef.current) {
      refs.setReference(anchorRef.current);
    }
  }, [anchorRef, refs]);

  // Fetch scripts
  useEffect(() => {
    let canceled = false;
    window.api.scripts.getAll(projectPath).then((s) => {
      if (canceled) return;
      setScripts(s);
      requestAnimationFrame(() => setReady(true));
    });
    return () => {
      canceled = true;
    };
  }, [projectPath]);

  // Click-outside handler
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [anchorRef, onClose]);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={(el) => {
        dropdownRef.current = el;
        refs.setFloating(el);
      }}
      role="menu"
      aria-label="Run options"
      style={floatingStyles}
      className={`min-w-[180px] max-w-[280px] bg-surface border border-border rounded-md shadow-lg z-[1000] overflow-hidden py-1 transition-opacity duration-100 ${ready ? 'opacity-100' : 'opacity-0'}`}
    >
      {hasRunHook && (
        <button
          role="menuitem"
          className="block w-full text-left px-3 py-1.5 text-xs text-text-primary bg-transparent hover:bg-background-tertiary transition-colors duration-100 ease-out"
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelectRunHook();
          }}
        >
          <span className="flex items-center gap-2">
            <Icon name="play" className="w-3.5 h-3.5 text-text-secondary" />
            <span>Run</span>
            <span className="ml-auto text-text-tertiary text-[11px]">default</span>
          </span>
        </button>
      )}
      {scripts.map((script) => (
        <button
          key={script.id}
          role="menuitem"
          className="block w-full text-left px-3 py-1.5 text-xs text-text-primary bg-transparent hover:bg-background-tertiary transition-colors duration-100 ease-out"
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelectScript({ name: script.name, command: script.command });
          }}
        >
          <span className="flex items-center gap-2">
            <Icon name="terminal" className="w-3.5 h-3.5 text-text-secondary" />
            <span className="truncate">{script.name}</span>
          </span>
        </button>
      ))}
      {scripts.length === 0 && !hasRunHook && (
        <div className="px-3 py-2 text-xs text-text-tertiary">No scripts configured</div>
      )}
    </div>,
    document.body,
  );
}
