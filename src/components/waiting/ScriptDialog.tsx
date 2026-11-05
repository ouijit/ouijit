import { useEffect, useState } from 'react';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { CodePreview } from '../common/CodePreview';
import { homeRelative } from '../sidebar/SidebarRows';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { ScriptPreview } from './ScriptPreview';

/** An ask's script read at full size, before it runs: too much to read at the foot of a terminal. */
export function ScriptDialog({
  item,
  onRun,
  onClose,
}: {
  item: Extract<Waiting, { kind: 'ask' }>;
  onRun: () => void;
  onClose: () => void;
}) {
  const label = useTerminalStore((s) => s.displayStates[item.from]?.label ?? 'A terminal');
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { ask } = item;
  if (!ask.file) return null;

  return (
    <DialogOverlay visible={visible} onDismiss={onClose} maxWidth={760}>
      <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
        {label} <span className="font-normal text-text-secondary">asks to run</span>
      </h2>
      {ask.message && <p className="mt-2 text-sm leading-5 text-text-primary">{ask.message}</p>}
      <div className="mt-4">
        <CodePreview
          code={ask.command}
          lang="bash"
          path={homeRelative(ask.cwd)}
          showLang={false}
          lineNumbers={false}
          maxHeight="max-h-24"
        />
      </div>
      <div className="mt-3">
        <ScriptPreview file={ask.file} maxHeight="max-h-[max(8rem,calc(100vh-30rem))]" />
      </div>
      {ask.runCommand && (
        <p className="mt-3 text-xs text-text-tertiary">
          The script runs as it was when asked, even if the file changes.
        </p>
      )}
      <div className="flex gap-2 justify-end mt-4">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            onClose();
            useWaitingStore.getState().remove(item.id);
          }}
        >
          Decline
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            onClose();
            onRun();
          }}
        >
          Run
        </button>
      </div>
    </DialogOverlay>
  );
}
