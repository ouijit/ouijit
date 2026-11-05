import { useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { focusTerminal } from '../navigation';
import { MenuPopover } from '../ui/Menu';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';

const isMac = navigator.platform.toLowerCase().includes('mac');
const NEXT_KEYS = isMac ? '⌘J' : 'Ctrl+J';

/** Opens an ask in its dialog, over its terminal; runs a move, whose hook brings its own dialog. */
export async function takeWaiting(item: Waiting): Promise<void> {
  const { openAsk, remove } = useWaitingStore.getState();
  if (item.kind === 'move') {
    remove(item.id);
    item.run();
    return;
  }
  if (item.from in useTerminalStore.getState().displayStates) await focusTerminal(item.from);
  openAsk(item.id);
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

function useNextShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || !(isMac ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      const [oldest] = useWaitingStore.getState().items;
      if (!oldest) return;
      e.preventDefault();
      e.stopPropagation();
      void takeWaiting(oldest);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

function Row({ item, first, onTake }: { item: Waiting; first: boolean; onTake: () => void }) {
  const from = useTerminalStore((s) => s.displayStates[item.from]?.label ?? 'A terminal');
  const taskName = useAppStore((s) =>
    item.kind === 'move'
      ? (s.taskCacheByProject[item.projectPath]?.find((t) => t.taskNumber === item.taskNumber)?.name ??
        `T-${item.taskNumber}`)
      : null,
  );
  const [title, detail] =
    item.kind === 'ask'
      ? [`${from} asks to run`, item.ask.command]
      : [taskName ?? '', `Run its ${item.hookType} hook, moved by ${from}`];

  return (
    <div className="group/row flex items-center gap-1">
      <button
        type="button"
        className="flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-100"
        onClick={onTake}
      >
        <span className="flex-1 min-w-0">
          <span className="block truncate text-text-primary">{title}</span>
          <span
            className={`block truncate mt-0.5 text-xs text-text-tertiary ${item.kind === 'ask' ? 'font-mono' : ''}`}
          >
            {detail}
          </span>
        </span>
        {first && (
          <kbd className="shrink-0 font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-ink/[0.06] text-text-tertiary">
            {NEXT_KEYS}
          </kbd>
        )}
      </button>
      <Tooltip text={item.kind === 'ask' ? 'Decline' : 'Skip the hook'} placement="left">
        <button
          type="button"
          aria-label={item.kind === 'ask' ? `Decline: ${detail}` : `Skip: ${title}`}
          className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[6px] border-none bg-transparent text-text-tertiary hover:bg-ink/[0.1] hover:text-text-primary"
          onClick={() => useWaitingStore.getState().remove(item.id)}
        >
          <Icon name="x" className="w-3 h-3" />
        </button>
      </Tooltip>
    </div>
  );
}

/** What agents left for the user to decide, oldest first, behind a count in the title bar. */
export function WaitingQueue() {
  const items = useWaitingStore((s) => s.items);
  const [open, setOpen] = useState(false);
  usePruneAsks();
  useNextShortcut();

  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (items.length === 0) return null;
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className="w-80 max-h-[26rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-9 px-3 ml-3 flex items-center gap-1.5 rounded-[14px] bg-accent text-accent-ink text-[13px] font-medium [-webkit-app-region:no-drag] transition-opacity duration-150 hover:opacity-90"
          onClick={() => setOpen(!open)}
        >
          {items.length} waiting
        </button>
      )}
    >
      {items.map((item, i) => (
        <Row
          key={item.id}
          item={item}
          first={i === 0}
          onTake={() => {
            setOpen(false);
            void takeWaiting(item);
          }}
        />
      ))}
    </MenuPopover>
  );
}
