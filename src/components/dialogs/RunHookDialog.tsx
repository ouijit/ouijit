import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ScriptHook, HookType } from '../../types';
import { useAutoResize } from '../../hooks/useAutoResize';

const HOOK_TITLES: Record<string, string> = {
  start: 'Start Task',
  continue: 'Continue Task',
  review: 'Review Task',
  cleanup: 'Done \u2014 Cleanup',
  run: 'Run',
};

const ENV_VARS = [
  '$OUIJIT_PROJECT_PATH',
  '$OUIJIT_WORKTREE_PATH',
  '$OUIJIT_TASK_BRANCH',
  '$OUIJIT_TASK_NAME',
  '$OUIJIT_TASK_PROMPT',
];

export interface RunHookResult {
  command: string;
  sandboxed: boolean;
  foreground: boolean;
}

interface RunHookDialogProps {
  hookType: HookType;
  hook: ScriptHook;
  projectPath: string;
  onClose: (result: RunHookResult | null) => void;
}

export function RunHookDialog({ hookType, hook, projectPath, onClose }: RunHookDialogProps) {
  const [command, setCommand] = useState(hook.command);
  const [sandboxed, setSandboxed] = useState(false);
  const [limaAvailable, setLimaAvailable] = useState(false);
  const [visible, setVisible] = useState(false);
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useAutoResize();

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
    window.api.lima
      .status(projectPath)
      .then((s) => setLimaAvailable(s.available))
      .catch(() => {});
  }, [projectPath]);

  const dismiss = useCallback(
    (result: RunHookResult | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') dismiss(null);
    },
    [dismiss],
  );

  const copyVar = useCallback((varName: string) => {
    navigator.clipboard.writeText(varName);
    setCopiedVar(varName);
    setTimeout(() => setCopiedVar(null), 1500);
  }, []);

  const title = HOOK_TITLES[hookType] || hookType;

  return createPortal(
    <div
      className={`modal-overlay fixed inset-0 flex justify-center z-[10001] p-10 overflow-y-auto bg-black/40 backdrop-blur-[4px] transition-opacity duration-200 ease-out ${visible ? 'modal-overlay--visible opacity-100' : 'opacity-0'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss(null);
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`dialog bg-surface rounded-[32px] shadow-lg max-w-[420px] w-[90%] p-6 border border-border overflow-hidden shrink-0 my-auto transition-all duration-200 ease-out ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2.5'}`}
      >
        <h2 className="dialog-title text-lg font-semibold text-text-primary mb-4 text-center">{title}</h2>

        <textarea
          ref={textareaRef}
          className="start-command-textarea w-full px-3 py-2 mb-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md outline-none resize-none overflow-hidden transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light"
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            autoResize(e);
          }}
          rows={1}
        />

        <details className="mt-3 text-xs text-text-secondary [&>summary]:cursor-default [&>summary]:select-none [&_ul]:mt-2 [&_ul]:mb-0 [&_ul]:pl-5 [&_li]:my-1">
          <summary>Environment variables</summary>
          <ul>
            {ENV_VARS.map((v) => (
              <li key={v}>
                <code
                  className={`font-mono text-[13px] px-1.5 py-0.5 rounded inline-block bg-background-secondary hover:text-text-primary hover:bg-border-hover ${copiedVar === v ? 'text-accent !bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)]' : ''}`}
                  style={{ transition: 'background 100ms ease, color 100ms ease' }}
                  onClick={() => copyVar(v)}
                >
                  {copiedVar === v ? 'Copied!' : v}
                </code>
              </li>
            ))}
          </ul>
        </details>

        <div className="flex gap-2 justify-between mt-4 items-center">
          {limaAvailable ? (
            <div className="flex items-center gap-2" onClick={() => setSandboxed((s) => !s)}>
              <div
                className={`relative w-[34px] h-5 rounded-[10px] shrink-0 transition-[background] duration-200 ease-out ${sandboxed ? 'bg-[#0a84ff]' : 'bg-white/15'}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-out ${sandboxed ? 'translate-x-3.5' : ''}`}
                />
              </div>
              <span className="text-xs text-white/40">Sandbox</span>
            </div>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              className="btn-secondary inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)]"
              onClick={() => dismiss(null)}
            >
              Cancel
            </button>
            <button
              className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98] whitespace-nowrap"
              onClick={() => dismiss({ command: command.trim(), sandboxed, foreground: true })}
              disabled={!command.trim()}
            >
              Run & Open
            </button>
            <button
              className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
              onClick={() => dismiss({ command: command.trim(), sandboxed, foreground: false })}
              disabled={!command.trim()}
            >
              Run
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
