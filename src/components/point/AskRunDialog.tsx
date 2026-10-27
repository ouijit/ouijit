import { useEffect, useState } from 'react';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { usePointerStore } from '../../stores/pointerStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { CodePreview } from '../common/CodePreview';
import { languageOf } from '../../utils/syntaxHighlight';
import { homeRelative } from '../sidebar/SidebarRows';
import { isActiveSandbox } from '../../types';

/** The open ask, for the user to run on this computer or decline. Closing it leaves the ask waiting. */
export function AskRunDialog() {
  const asking = usePointerStore((s) => s.asking);
  const pointer = usePointerStore((s) => s.pointers.find((p) => p.from === s.asking && p.ask));
  const display = useTerminalStore((s) => (asking ? s.displayStates[asking] : undefined));
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
  const { openAsk, answered } = usePointerStore.getState();

  return (
    <DialogOverlay visible={visible} onDismiss={() => openAsk(null)} maxWidth={520}>
      <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
        {display?.label ?? 'A terminal'} <span className="font-normal text-text-secondary">asks to run</span>
      </h2>
      <div className="mt-0.5 text-xs text-text-tertiary">
        {isActiveSandbox(display?.sandboxProvider) ? 'On your computer, outside its sandbox' : 'On your computer'}
        {pointer.laterAsks && ` · ${pointer.laterAsks.length} more after this`}
      </div>

      {ask.message && <p className="mt-4 text-[15px] leading-snug text-text-primary">“{ask.message}”</p>}

      <div className="mt-4">
        <CodePreview
          testId="ask-command"
          code={ask.command}
          lang="bash"
          path={homeRelative(ask.cwd)}
          showLang={false}
          lineNumbers={false}
          maxHeight="max-h-32"
        />
      </div>

      {ask.file && (
        <div className="mt-3">
          <CodePreview
            testId="ask-file"
            code={ask.file.contents}
            lang={languageOf(ask.file.path, ask.file.contents)}
            path={homeRelative(ask.file.path)}
          />
          {ask.runCommand && (
            <div className="mt-1.5 text-xs text-text-tertiary">Runs as shown, even if the file changes.</div>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end mt-5">
        <button data-testid="ask-decline" className="btn-secondary" onClick={() => answered(from)}>
          Decline
        </button>
        <button
          data-testid="ask-run"
          className="btn-primary"
          onClick={() => {
            ask.run();
            answered(from);
          }}
        >
          Run
        </button>
      </div>
    </DialogOverlay>
  );
}
