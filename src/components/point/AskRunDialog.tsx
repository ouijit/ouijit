import { useEffect, useState } from 'react';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { usePointerStore } from '../../stores/pointerStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { CodePreview } from '../common/CodePreview';
import { languageOf } from '../../utils/syntaxHighlight';

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
  const { openAsk, clear } = usePointerStore.getState();

  return (
    <DialogOverlay visible={visible} onDismiss={() => openAsk(null)} maxWidth={520}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary text-center mb-1">
        Run
      </h2>
      <div className="text-xs text-text-secondary text-center mb-4">
        {label ?? 'A terminal'} asks to run this on your computer
      </div>

      <CodePreview
        testId="ask-command"
        code={ask.command}
        lang="bash"
        path={ask.cwd}
        lineNumbers={false}
        maxHeight="max-h-32"
      />

      {ask.file && (
        <div className="mt-4">
          <CodePreview
            testId="ask-file"
            code={ask.file.contents}
            lang={languageOf(ask.file.path, ask.file.contents)}
            path={ask.file.path}
          />
          {ask.runCommand && (
            <div className="mt-1.5 text-xs text-text-tertiary">Runs as shown, even if the file changes.</div>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-text-tertiary">The agent can change files in this worktree.</p>
      {pointer.message && <p className="mt-2 text-sm text-text-secondary">{pointer.message}</p>}

      <div className="flex gap-2 justify-end mt-5">
        <button data-testid="ask-decline" className="btn-secondary" onClick={() => clear(from)}>
          Decline
        </button>
        <button
          data-testid="ask-run"
          className="btn-primary"
          onClick={() => {
            ask.run();
            clear(from);
          }}
        >
          Run
        </button>
      </div>
    </DialogOverlay>
  );
}
