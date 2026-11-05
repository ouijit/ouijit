import { useEffect, useState } from 'react';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { undecided, useWaitingStore } from '../../stores/waitingStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { CodePreview } from '../common/CodePreview';
import { languageOf } from '../../utils/syntaxHighlight';
import { homeRelative } from '../sidebar/SidebarRows';
import { isActiveSandbox } from '../../types';

/** Closes the answered ask, going on to the list when anything else still waits: asks never come up one after another. */
function answered(id: number, declined: boolean): void {
  const { remove, openAsk, setListOpen } = useWaitingStore.getState();
  if (declined) remove(id);
  const rest = useWaitingStore.getState().items.filter((i) => i.id !== id && undecided(i));
  if (rest.length > 0) setListOpen(true);
  else openAsk(null);
}

/** The one ask waiting, opened over its terminal, to run on this computer or decline. Closing it leaves it in the queue. */
export function AskRunDialog() {
  const item = useWaitingStore((s) => s.items.find((i) => i.id === s.open && i.kind === 'ask' && !i.ran));
  const display = useTerminalStore((s) => (item ? s.displayStates[item.from] : undefined));
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!item) return;
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(frame);
      setVisible(false);
    };
  }, [item]);

  if (item?.kind !== 'ask') return null;
  const { ask, id } = item;
  const { openAsk } = useWaitingStore.getState();

  return (
    <DialogOverlay visible={visible} onDismiss={() => openAsk(null)} maxWidth={520}>
      <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
        {display?.label ?? 'A terminal'} <span className="font-normal text-text-secondary">asks to run</span>
      </h2>

      {ask.message && (
        <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-text-primary">
          {ask.message}
        </p>
      )}

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
        </div>
      )}

      <p className="mt-4 text-xs text-text-tertiary">
        {isActiveSandbox(display?.sandboxProvider)
          ? 'Runs on your computer, outside its sandbox.'
          : 'Runs on your computer.'}
        {ask.runCommand && ' The script runs as shown, even if the file changes.'}
      </p>

      <div className="flex gap-2 justify-end mt-4">
        <button data-testid="ask-decline" className="btn-secondary" onClick={() => answered(id, true)}>
          Decline
        </button>
        <button
          data-testid="ask-run"
          className="btn-primary"
          onClick={() => {
            ask.run();
            answered(id, false);
          }}
        >
          Run
        </button>
      </div>
    </DialogOverlay>
  );
}
