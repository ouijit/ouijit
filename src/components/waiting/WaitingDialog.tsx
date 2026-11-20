import { useEffect, useRef } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { CodePreview } from '../common/CodePreview';
import { homeRelative } from '../sidebar/SidebarRows';
import { isActiveSandbox } from '../../types';
import { ScriptPreview, scriptRisks } from './ScriptPreview';
import { StageIcon } from '../sidebar/StageIcon';
import { Icon } from '../terminal/Icon';

const isMac = navigator.platform.toLowerCase().includes('mac');

/** What running a held hook does to its task, in a word. */
export const HOOK_VERB: Record<string, string> = {
  start: 'Start',
  continue: 'Resume',
  review: 'Review',
  done: 'Finish',
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

export function useTaskName(item: Waiting): string | null {
  return useAppStore((s) =>
    item.kind === 'move'
      ? (s.taskCacheByProject[item.projectPath]?.find((t) => t.taskNumber === item.taskNumber)?.name ??
        `T-${item.taskNumber}`)
      : null,
  );
}

/** The terminal that asked, as the sidebar shows it: its task where it has one. */
export function useAsker(ptyId: string) {
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

export function useMovesOwnTask(item: Waiting): boolean {
  return useTerminalStore((s) => {
    const display = s.displayStates[item.from];
    return item.kind === 'move' && display?.taskId === item.taskNumber && display.projectPath === item.projectPath;
  });
}

function Detail({ item, titleId }: { item: Waiting; titleId: string }) {
  const taskName = useTaskName(item);
  const sandboxed = useTerminalStore((s) => isActiveSandbox(s.displayStates[item.from]?.sandboxProvider));
  const ownTask = useMovesOwnTask(item);

  if (item.kind === 'move') {
    return (
      <>
        {!ownTask && <AskerRow ptyId={item.from} />}
        <h2
          id={titleId}
          data-testid="dialog-title"
          className={`${ownTask ? '' : 'mt-3.5 '}text-[17px] font-semibold text-text-primary`}
        >
          {HOOK_VERB[item.hookType] ?? 'Move'} {taskName}
        </h2>
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
        {item.outsideSandbox && (
          <p className="mt-4 text-xs text-text-tertiary">Runs on your computer, outside the sandbox.</p>
        )}
      </>
    );
  }

  const { ask } = item;
  const risks = scriptRisks(ask.file);
  return (
    <>
      <h2 id={titleId} data-testid="dialog-title">
        <AskerRow ptyId={item.from} />
      </h2>
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
    <span className="flex items-center gap-2 min-w-0 text-text-secondary">
      <span className="shrink-0 flex">{asker.icon}</span>
      <span className="flex-1 min-w-0 truncate text-sm font-semibold text-text-primary">{asker.name}</span>
      {asker.number && <span className="shrink-0 font-mono text-xs text-text-tertiary">{asker.number}</span>}
    </span>
  );
}

/**
 * What this terminal's agent left for the user, over its card and nowhere
 * else. Only answering takes it away: Esc and a click outside go to the
 * terminal, which the agent is blocked on anyway.
 */
export function WaitingDialog({ ptyId }: { ptyId: string }) {
  const item = useWaitingStore((s) => s.items.find((i) => i.from === ptyId));
  const { remove } = useWaitingStore.getState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => useWaitingStore.getState().cardMounted(ptyId), [ptyId]);

  useEffect(() => {
    if (!item) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(isMac ? e.metaKey : e.ctrlKey) || e.repeat) return;
      if (!ref.current?.parentElement?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      runWaiting(item);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [item]);

  if (!item) return null;
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-20 flex justify-center overflow-y-auto p-6"
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
    >
      <div
        role="dialog"
        aria-labelledby={`waiting-${item.id}`}
        className="bg-surface rounded-[32px] shadow-lg w-full max-w-[640px] p-6 border border-border shrink-0 my-auto"
      >
        <Detail key={item.id} item={item} titleId={`waiting-${item.id}`} />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button data-testid="waiting-decline" className="btn-secondary" onClick={() => remove(item.id)}>
            {item.kind === 'ask' ? 'Decline' : 'Skip'}
          </button>
          {item.kind === 'ask' && (
            <button data-testid="waiting-run-private" className="btn-secondary" onClick={() => runWaiting(item, true)}>
              Run privately
            </button>
          )}
          <button data-testid="waiting-run" className="btn-primary" onClick={() => runWaiting(item)}>
            Run <kbd className="ml-1 font-sans opacity-60">{isMac ? '⌘↵' : 'Ctrl+↵'}</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
