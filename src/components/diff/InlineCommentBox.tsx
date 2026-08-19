import { useState, type ReactNode } from 'react';

/**
 * A saved comment, before it is opened for editing. Indented to clear the
 * line-number gutter, matching the editor it turns into.
 */
export function InlineCommentCard({ label, body, onClick }: { label: string; body: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="relative glass-bevel block w-[calc(100%-176px)] mx-[88px] my-1.5 text-left px-3 py-2 bg-terminal-surface border border-bezel rounded-[12px] text-sm text-text-secondary hover:bg-ink/[0.06] transition-colors duration-100"
      onClick={onClick}
    >
      <span className="block text-[11px] text-accent mb-0.5">{label}</span>
      {body}
    </button>
  );
}

interface InlineCommentBoxProps {
  /** Set when editing something already written rather than starting fresh. */
  initialBody?: string;
  onSave: (body: string) => Promise<void>;
  onCancel: () => void;
  onDiscard?: () => Promise<void>;
  placeholder?: string;
  /** The button's word for saving — "Add comment", "Update note". */
  saveLabel?: string;
  /** One line under the box saying where what is written goes. */
  hint?: string;
}

/**
 * The editor for one comment anchored to a diff line. Indented to clear the
 * line-number gutter, matching the card it replaces.
 */
export function InlineCommentBox({
  initialBody,
  onSave,
  onCancel,
  onDiscard,
  placeholder = 'Leave a comment…',
  saveLabel = 'Add comment',
  hint,
}: InlineCommentBoxProps) {
  const [body, setBody] = useState(initialBody ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative glass-bevel mx-[88px] my-1.5 px-3 py-2.5 bg-terminal-surface border border-bezel rounded-[12px]">
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === 'Escape') {
            // Claim it, or the panel's own Escape handler closes the whole view.
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        className="field resize-y"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          disabled={!body.trim() || busy}
          className="btn-primary btn-compact"
          onClick={() => void save()}
        >
          {saveLabel}
        </button>
        <button type="button" className="btn-secondary btn-compact" onClick={onCancel}>
          Cancel
        </button>
        {onDiscard && (
          <button
            type="button"
            className="ml-auto text-[13px] text-text-tertiary hover:text-error transition-colors duration-100"
            onClick={() => void onDiscard()}
          >
            Discard
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-text-tertiary mt-1.5">{hint}</p>}
    </div>
  );
}
