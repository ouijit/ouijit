import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { CodePreview } from '../common/CodePreview';
import { homeRelative } from '../sidebar/SidebarRows';
import { isActiveSandbox } from '../../types';
import { ScriptPreview, scriptRisks } from './ScriptPreview';
import { StageIcon } from '../sidebar/StageIcon';
import { Icon } from '../terminal/Icon';
import { useHomeChatStore, useIsHomeChat } from '../../stores/homeChatStore';

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
  const home = useIsHomeChat(ptyId);
  const conversation = useHomeChatStore((s) => s.chats.find((chat) => chat.id === ptyId)?.title);
  const display = useTerminalStore((s) => s.displayStates[ptyId]);
  const task = useAppStore((s) =>
    display?.taskId != null
      ? s.taskCacheByProject[display.projectPath]?.find((t) => t.taskNumber === display.taskId)
      : undefined,
  );
  if (home) {
    return { name: conversation ?? 'Chat', number: null, icon: <Icon name="chat-circle" className="w-3.5 h-3.5" /> };
  }
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
  if (ask.url) {
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
        <p data-testid="waiting-command" className="mt-4 font-mono text-[13px] break-all text-text-primary">
          {ask.url}
        </p>
        <p className="mt-4 text-xs leading-[17px] text-text-tertiary">Opens in a preview, outside its sandbox.</p>
      </>
    );
  }
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

function ListEntry({ item, selected, onPick }: { item: Waiting; selected: boolean; onPick: () => void }) {
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
          {item.ask.message && <span className="text-[13px] text-text-primary truncate">{item.ask.message}</span>}
          <span className="font-mono text-[11.5px] text-text-tertiary truncate">{item.ask.command}</span>
        </>
      ) : (
        <>
          <span className="text-[13px] text-text-primary truncate">
            {HOOK_VERB[item.hookType] ?? 'Move'} {taskName}
          </span>
          <span className="text-[11.5px] text-text-tertiary truncate">{item.hookName || 'Hook'}</span>
        </>
      )}
    </button>
  );
}

/**
 * What this terminal's agent left for the user, over its card and nowhere
 * else. Only answering takes it away: Esc and a click outside go to the
 * terminal, which the agent is blocked on anyway. With more than one, a list
 * down the side takes them in any order.
 */
export function WaitingDialog({ ptyId }: { ptyId: string }) {
  const items = useWaitingStore(useShallow((s) => s.items.filter((i) => i.from === ptyId)));
  const [selected, setSelected] = useState<number | null>(null);
  const item = items.find((i) => i.id === selected) ?? items[0];
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
  const several = items.length > 1;

  const footer = (
    <div className="flex flex-wrap items-center justify-end gap-2 mt-4 shrink-0 [&>button]:whitespace-nowrap">
      <button data-testid="waiting-decline" className="btn-secondary" onClick={() => remove(item.id)}>
        {item.kind === 'ask' ? 'Decline' : 'Skip'}
      </button>
      {item.kind === 'ask' && !item.ask.url && (
        <button data-testid="waiting-run-private" className="btn-secondary" onClick={() => runWaiting(item, true)}>
          Run privately
        </button>
      )}
      <button data-testid="waiting-run" className="btn-primary" onClick={() => runWaiting(item)}>
        {item.kind === 'ask' && item.ask.url ? 'Open' : 'Run'}{' '}
        <kbd className="ml-1 font-sans opacity-60">{isMac ? '⌘↵' : 'Ctrl+↵'}</kbd>
      </button>
    </div>
  );
  const detail = <Detail key={item.id} item={item} titleId={`waiting-${item.id}`} />;

  return (
    <div
      ref={ref}
      className="@container absolute inset-0 z-20 flex justify-center overflow-y-auto p-6"
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
    >
      {several ? (
        <div
          role="dialog"
          aria-labelledby={`waiting-${item.id}`}
          className="bg-surface rounded-[32px] shadow-lg w-full max-w-[880px] h-[min(36rem,100%)] border border-border shrink-0 my-auto overflow-hidden flex"
        >
          <nav
            aria-label="Waiting"
            className="w-44 @xl:w-56 shrink-0 flex flex-col gap-0.5 px-2.5 py-5 overflow-y-auto"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 22%, var(--color-background))' }}
          >
            <div className="px-2.5 pb-2 text-xs text-text-tertiary">{items.length} waiting on you</div>
            {items.map((i) => (
              <ListEntry key={i.id} item={i} selected={i.id === item.id} onPick={() => setSelected(i.id)} />
            ))}
          </nav>
          <div aria-hidden className="pane-seam w-px shrink-0" />
          <div className="flex-1 min-w-0 min-h-0 p-6 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto">{detail}</div>
            {footer}
          </div>
        </div>
      ) : (
        <div
          role="dialog"
          aria-labelledby={`waiting-${item.id}`}
          className="bg-surface rounded-[32px] shadow-lg w-full max-w-[640px] p-6 border border-border shrink-0 my-auto"
        >
          {detail}
          {footer}
        </div>
      )}
    </div>
  );
}
