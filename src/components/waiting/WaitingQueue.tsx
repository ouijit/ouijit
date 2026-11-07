import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { CodePreview } from '../common/CodePreview';
import { homeRelative } from '../sidebar/SidebarRows';
import { isActiveSandbox } from '../../types';
import { ScriptPreview, scriptRisks } from './ScriptPreview';
import { StageIcon } from '../sidebar/StageIcon';
import { Icon } from '../terminal/Icon';

const isMac = navigator.platform.toLowerCase().includes('mac');

/** What running a held hook does to its task, in a word. */
const HOOK_VERB: Record<string, string> = {
  start: 'Start',
  continue: 'Resume',
  review: 'Review',
  done: 'Finish',
};

const MOVED_TO: Record<string, string> = {
  start: 'In Progress',
  continue: 'In Progress',
  review: 'In Review',
  done: 'Done',
};

/** Runs what the user picked: an ask in a runner on its terminal, a move's hook with no dialog of its own. */
export function runWaiting(item: Waiting, privately = false): void {
  if (item.kind === 'ask') {
    item.ask.run(privately);
    return;
  }
  useWaitingStore.getState().remove(item.id);
  item.run();
}

/** An ask from a terminal that has gone can no longer run where it asked to. */
function usePruneAsks(): void {
  useEffect(
    () =>
      useTerminalStore.subscribe((s) => {
        const { items, remove } = useWaitingStore.getState();
        for (const item of items) if (item.kind === 'ask' && !(item.from in s.displayStates)) remove(item.id);
      }),
    [],
  );
}

function useOpenShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || !(isMac ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      const waiting = useWaitingStore.getState();
      if (waiting.items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (waiting.open) waiting.close();
      else waiting.show();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

function useTaskName(item: Waiting): string | null {
  return useAppStore((s) =>
    item.kind === 'move'
      ? (s.taskCacheByProject[item.projectPath]?.find((t) => t.taskNumber === item.taskNumber)?.name ??
        `T-${item.taskNumber}`)
      : null,
  );
}

/** The terminal that asked, as the sidebar shows it: its task where it has one. */
function useAsker(ptyId: string) {
  const display = useTerminalStore((s) => s.displayStates[ptyId]);
  const task = useAppStore((s) =>
    display?.taskId != null
      ? s.taskCacheByProject[display.projectPath]?.find((t) => t.taskNumber === display.taskId)
      : undefined,
  );
  return {
    name: task?.name ?? display?.label ?? 'A terminal',
    number: display?.taskId != null ? `T-${display.taskId}` : null,
    icon: task ? <StageIcon status={task.status} /> : <Icon name="terminal-window" className="w-3.5 h-3.5" />,
  };
}

function ListEntry({ item, selected, onPick }: { item: Waiting; selected: boolean; onPick: () => void }) {
  const from = useTerminalStore((s) => s.displayStates[item.from]?.label ?? 'A terminal');
  const asker = useAsker(item.from);
  const taskName = useTaskName(item);
  return (
    <button
      type="button"
      aria-current={selected || undefined}
      className={`w-full flex flex-col gap-0.5 px-2.5 py-2 rounded-[10px] text-left transition-colors duration-100 ${
        selected ? 'bg-accent/[0.12]' : 'hover:bg-ink/[0.05]'
      }`}
      onClick={onPick}
    >
      {item.kind === 'ask' ? (
        <>
          <span className="flex items-center gap-1.5 min-w-0 text-text-secondary">
            <span className="shrink-0 flex">{asker.icon}</span>
            <span className="text-[12.5px] font-semibold text-text-primary truncate">{asker.name}</span>
          </span>
          <span className="font-mono text-[11.5px] text-text-tertiary truncate">{item.ask.command}</span>
        </>
      ) : (
        <>
          <span className="text-[13px] text-text-primary truncate">
            {HOOK_VERB[item.hookType] ?? 'Move'} {taskName}
          </span>
          <span className="text-[11.5px] text-text-tertiary truncate">{`${item.hookName || 'Hook'}, from ${from}`}</span>
        </>
      )}
    </button>
  );
}

/** The one item the dialog shows, at full size: who wants it, why, what runs, and the script it runs. */
function Detail({ item }: { item: Waiting }) {
  const display = useTerminalStore((s) => s.displayStates[item.from]);
  const taskName = useTaskName(item);
  const from = display?.label ?? 'A terminal';
  const sandboxed = isActiveSandbox(display?.sandboxProvider);

  if (item.kind === 'move') {
    return (
      <>
        <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
          {HOOK_VERB[item.hookType] ?? 'Move'} {taskName}
        </h2>
        <p className="mt-2 text-sm leading-5 text-text-primary">
          {from} moved {taskName} to {MOVED_TO[item.hookType] ?? item.hookType}.
        </p>
        <div className="mt-4">
          <CodePreview
            testId="waiting-command"
            code={item.command}
            lang="bash"
            path={item.hookName || 'Hook'}
            showLang={false}
            lineNumbers={false}
            maxHeight="max-h-32"
          />
        </div>
        <p className="mt-4 text-xs text-text-tertiary">
          Opens a terminal for {taskName} running this
          {item.outsideSandbox ? ', on your computer, outside the sandbox.' : '.'}
        </p>
      </>
    );
  }

  const { ask } = item;
  const risks = scriptRisks(ask.file);
  return (
    <>
      <AskerRow ptyId={item.from} />
      {ask.message && (
        <p className="mt-3.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[15px] leading-[22px] text-text-primary">
          {ask.message}
        </p>
      )}
      <div className="mt-4">
        <CodePreview
          testId="waiting-command"
          code={ask.command}
          lang="bash"
          path={homeRelative(ask.cwd)}
          showLang={false}
          lineNumbers={false}
          maxHeight="max-h-24"
        />
      </div>
      {ask.file && (
        <div className="mt-3">
          <ScriptPreview file={ask.file} maxHeight="max-h-[max(8rem,calc(100vh-30rem))]" />
        </div>
      )}
      <p className="mt-4 text-xs leading-[17px] text-text-tertiary">
        {sandboxed ? 'Runs on your computer, outside its sandbox.' : 'Runs on your computer.'}
        {ask.runCommand && ' The script runs as it was when asked, even if the file changes.'}
        {' Run privately and the agent learns only whether it succeeded.'}
        {risks.length > 0 && <span className="text-error"> {risks.join('. ')}.</span>}
      </p>
    </>
  );
}

function AskerRow({ ptyId }: { ptyId: string }) {
  const asker = useAsker(ptyId);
  return (
    <h2 data-testid="dialog-title" className="flex items-center gap-2 min-w-0 text-text-secondary">
      <span className="shrink-0 flex">{asker.icon}</span>
      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary">{asker.name}</span>
      {asker.number && <span className="shrink-0 font-mono text-xs text-text-tertiary">{asker.number}</span>}
    </h2>
  );
}

/**
 * Everything agents left for the user, one at a time at full size. With more
 * than one, a list down the side shows the rest and takes them in any order;
 * answering one brings up the next in place.
 */
function WaitingDialog() {
  const items = useWaitingStore((s) => s.items);
  const selected = useWaitingStore((s) => s.selected);
  const [visible, setVisible] = useState(false);
  const { close, remove, show } = useWaitingStore.getState();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const current = items.find((i) => i.id === selected) ?? items[0];
  if (!current) return null;
  const several = items.length > 1;

  const footer = (
    <div className="flex items-center gap-2 mt-4 shrink-0">
      {several && (
        <button
          type="button"
          className="px-3.5 py-1.5 rounded-full text-sm text-text-secondary hover:text-text-primary hover:bg-ink/[0.05] transition-colors duration-100"
          onClick={() => items.forEach((item) => runWaiting(item))}
        >
          Run all {items.length}
        </button>
      )}
      <span className="flex-1" />
      <button data-testid="waiting-decline" className="btn-secondary" onClick={() => remove(current.id)}>
        {current.kind === 'ask' ? 'Decline' : 'Skip'}
      </button>
      {current.kind === 'ask' && (
        <button data-testid="waiting-run-private" className="btn-secondary" onClick={() => runWaiting(current, true)}>
          Run privately
        </button>
      )}
      <button data-testid="waiting-run" className="btn-primary" onClick={() => runWaiting(current)}>
        Run
      </button>
    </div>
  );

  return (
    <DialogOverlay visible={visible} onDismiss={close} maxWidth={several ? 880 : 640}>
      {several ? (
        // The overlay pads its card; the list runs to its edges.
        <div className="-m-6 flex h-[min(36rem,calc(100vh-5rem))]">
          <nav
            aria-label="Waiting"
            className="w-60 shrink-0 flex flex-col gap-0.5 px-2.5 py-5 overflow-y-auto"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 22%, var(--color-background))' }}
          >
            <div className="px-2.5 pb-2 text-xs text-text-tertiary">{items.length} waiting on you</div>
            {items.map((item) => (
              <ListEntry key={item.id} item={item} selected={item.id === current.id} onPick={() => show(item.id)} />
            ))}
          </nav>
          <div
            aria-hidden
            className="w-px shrink-0"
            style={{ background: 'var(--seam-cut)', boxShadow: '1px 0 0 var(--seam-catch)' }}
          />
          <div className="flex-1 min-w-0 p-6 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Detail key={current.id} item={current} />
            </div>
            {footer}
          </div>
        </div>
      ) : (
        <>
          <Detail item={current} />
          {footer}
        </>
      )}
    </DialogOverlay>
  );
}

/** A count of what waits on the user in the title bar, opening the dialog that shows it. */
export function WaitingQueue() {
  const count = useWaitingStore((s) => s.items.length);
  const open = useWaitingStore((s) => s.open);
  usePruneAsks();
  useOpenShortcut();

  return (
    <>
      {count > 0 && (
        <button
          type="button"
          className="h-9 px-3 ml-3 flex items-center gap-2 bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] text-[13px] text-text-secondary transition-all duration-150 ease-out [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary"
          onClick={() => useWaitingStore.getState().show()}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {count} waiting
        </button>
      )}
      {open && count > 0 && <WaitingDialog />}
    </>
  );
}
