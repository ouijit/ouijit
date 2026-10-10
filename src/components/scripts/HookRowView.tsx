import type { MouseEvent } from 'react';

export interface HookRowViewProps {
  label: string;
  description: string;
  /** The current command for this hook, if configured. */
  command?: string;
  /** Names the sandbox the command runs in; absent runs it on the host. */
  sandboxLabel?: string;
  /** Click handler for the right-side action. */
  onAction?: (e: MouseEvent) => void;
  /** Override the action label (defaults to "Edit" when configured, "+ Configure" when not). */
  actionLabel?: string;
}

/**
 * Pure visual row for a single lifecycle hook. Used by HookList (smart wrapper)
 * and by the marketing site's Automation demo.
 */
export function HookRowView({ label, description, command, sandboxLabel, onAction, actionLabel }: HookRowViewProps) {
  const buttonLabel = actionLabel ?? (command ? 'Edit' : '+ Configure');
  return (
    <div className="group flex items-center gap-3 px-3 py-2 hover:bg-ink/[0.04] transition-colors duration-100">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-primary">{label}</span>
          <span className="text-[11px] text-text-tertiary">{description}</span>
        </div>
        {command && (
          <div className="flex items-center gap-2 mt-0.5 min-w-0">
            <span className="font-mono text-[11px] text-text-secondary truncate">{command}</span>
            {sandboxLabel && <span className="shrink-0 text-[11px] text-text-tertiary">{sandboxLabel} sandbox</span>}
          </div>
        )}
      </div>
      <button
        className="shrink-0 px-2 py-1 text-[11px] bg-transparent border-none text-text-tertiary hover:text-text-primary transition-colors duration-150"
        onClick={onAction}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
