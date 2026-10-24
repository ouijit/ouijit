import { useEffect, useState } from 'react';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { usePointerStore } from '../../stores/pointerStore';
import { useTerminalStore } from '../../stores/terminalStore';

const CODE =
  'w-full px-3 py-2 font-mono text-sm leading-snug text-text-primary bg-background border border-border rounded-md whitespace-pre-wrap break-all';

/** The open ask, for the user to run on this computer or decline. Closing it leaves the ask waiting. */
export function AskRunDialog() {
  const asking = usePointerStore((s) => s.asking);
  const pointer = usePointerStore((s) => s.pointers.find((p) => p.from === s.asking && p.ask));
  const label = useTerminalStore((s) => (asking ? s.displayStates[asking]?.label : undefined));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pointer) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(frame);
      setVisible(false);
    };
  }, [pointer]);

  if (!pointer?.ask) return null;
  const { ask, from } = pointer;
  const { openAsk, dismiss } = usePointerStore.getState();

  return (
    <DialogOverlay visible={visible} onDismiss={() => openAsk(null)} maxWidth={520}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary text-center mb-1">
        Run
      </h2>
      <div className="text-xs text-text-secondary text-center mb-4">
        {label ?? 'A terminal'} asks to run this on your computer
      </div>

      <pre data-testid="ask-command" className={CODE}>
        {ask.command}
      </pre>
      <div className="mt-1.5 font-mono text-xs text-text-tertiary truncate" title={ask.cwd}>
        {ask.cwd}
      </div>

      {ask.file && (
        <div className="mt-4">
          <div className="text-xs text-text-secondary mb-1.5">{ask.file.path}</div>
          <pre data-testid="ask-file" className={`${CODE} max-h-60 overflow-auto text-xs`}>
            {ask.file.contents}
          </pre>
        </div>
      )}

      <p className="mt-4 text-xs text-text-tertiary">The agent can change files in this worktree.</p>
      {pointer.message && <p className="mt-2 text-sm text-text-secondary">{pointer.message}</p>}

      <div className="flex gap-2 justify-end mt-5">
        <button data-testid="ask-decline" className="btn-secondary" onClick={() => dismiss(from)}>
          Decline
        </button>
        <button
          data-testid="ask-run"
          className="btn-primary"
          onClick={() => {
            ask.run();
            dismiss(from);
          }}
        >
          Run
        </button>
      </div>
    </DialogOverlay>
  );
}
