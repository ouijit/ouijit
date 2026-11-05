import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { getActivePtyId, useTerminalStore } from '../../stores/terminalStore';
import { launchesAgent, undecided, useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { focusTerminal } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { MenuPopover } from '../ui/Menu';
import { formatAge } from '../../utils/formatDate';
import { isActiveSandbox } from '../../types';
import { ScriptPreview, scriptRisks } from './ScriptPreview';

const isMac = navigator.platform.toLowerCase().includes('mac');

const MOVED_TO: Record<string, string> = {
  start: 'In Progress',
  continue: 'In Progress',
  review: 'In Review',
  done: 'Done',
};

/** Runs what the user picked: an ask in a runner on its terminal, a move's hook with no dialog of its own. */
export function runWaiting(item: Waiting): void {
  if (item.kind === 'ask') {
    item.ask.run();
    return;
  }
  useWaitingStore.getState().remove(item.id);
  item.run();
}

function commandOf(item: Waiting): string {
  return item.kind === 'ask' ? item.ask.command : item.command;
}

/** Terminals with something waiting, in the order the first of each arrived. */
function waitingTerminals(items: Waiting[]): string[] {
  return [...new Set(items.map((i) => i.from))];
}

function viewedTerminal(): string | undefined {
  const { selection } = useAppStore.getState();
  return selection.kind === 'terminal' ? getActivePtyId(selection.stack) : undefined;
}

/** Goes to the next terminal with something waiting, after the one on screen. */
function goToNext(): void {
  const terminals = waitingTerminals(useWaitingStore.getState().items);
  if (terminals.length === 0) return;
  const at = terminals.indexOf(viewedTerminal() ?? '');
  void focusTerminal(terminals[(at + 1) % terminals.length]);
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
      if (useWaitingStore.getState().items.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      goToNext();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

/** What makes an item worth a second look. */
function useRisks(item: Waiting): string[] {
  const sandboxed = useTerminalStore((s) => isActiveSandbox(s.displayStates[item.from]?.sandboxProvider));
  return [
    ...(launchesAgent(commandOf(item)) ? ['starts an agent'] : []),
    ...((item.kind === 'ask' ? sandboxed : item.outsideSandbox) ? ['outside its sandbox'] : []),
    ...(item.kind === 'ask' ? scriptRisks(item.ask.file).map((r) => r.toLowerCase()) : []),
  ];
}

const BUTTON = 'h-6 px-2.5 rounded-md text-xs font-medium transition-colors duration-100 shrink-0';
const QUIET = `${BUTTON} bg-ink/[0.07] text-text-primary hover:bg-ink/[0.11]`;
const PRIMARY = `${BUTTON} bg-accent text-accent-ink hover:opacity-90`;
const LINK = 'text-xs text-text-secondary hover:text-text-primary transition-colors duration-100 shrink-0';

function asked(ms: number): string {
  const age = formatAge(ms / 1000);
  return age === 'now' ? 'Asked just now' : `Asked ${age} ago`;
}

function Row({ item }: { item: Waiting }) {
  const [script, setScript] = useState(false);
  const risks = useRisks(item);
  const taskName = useAppStore((s) =>
    item.kind === 'move'
      ? (s.taskCacheByProject[item.projectPath]?.find((t) => t.taskNumber === item.taskNumber)?.name ??
        `T-${item.taskNumber}`)
      : null,
  );
  const ran = item.kind === 'ask' ? item.ran : undefined;
  const file = item.kind === 'ask' ? item.ask.file : undefined;
  const { remove } = useWaitingStore.getState();
  const why =
    item.kind === 'ask'
      ? (item.ask.message ?? asked(Date.now() - item.at))
      : `Moved ${taskName} to ${MOVED_TO[item.hookType] ?? item.hookType}, its ${item.hookType} hook`;
  const showRunner = () => {
    if (ran) terminalInstances.get(item.from)?.activatePanel(ran.panelId);
  };

  return (
    <div data-testid="waiting-row" className="px-2 py-[7px] border-t border-ink/[0.06] first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span data-testid="waiting-command" className="font-mono text-xs text-text-primary truncate">
            {commandOf(item)}
          </span>
          <span className="text-[11.5px] text-text-tertiary truncate">
            {why}
            {risks.map((risk) => (
              <span key={risk}>
                {' · '}
                <span className="text-error">{risk}</span>
              </span>
            ))}
          </span>
        </span>
        {ran ? (
          <>
            {ran.status === 'running' ? (
              <span className="text-xs text-text-tertiary shrink-0">Running…</span>
            ) : (
              <span className="text-xs text-error shrink-0">
                Failed{ran.exitCode != null && `, exit ${ran.exitCode}`}
              </span>
            )}
            <button type="button" className={LINK} onClick={showRunner}>
              Show runner
            </button>
            {ran.status === 'failed' && (
              <button type="button" className={QUIET} onClick={() => remove(item.id)}>
                Dismiss
              </button>
            )}
          </>
        ) : (
          <>
            {file && (
              <button type="button" className={LINK} onClick={() => setScript(!script)}>
                {script ? 'Hide script' : 'Script'}
              </button>
            )}
            <button type="button" className={QUIET} onClick={() => remove(item.id)}>
              {item.kind === 'ask' ? 'Decline' : 'Skip'}
            </button>
            <button type="button" className={PRIMARY} onClick={() => runWaiting(item)}>
              Run
            </button>
          </>
        )}
      </div>
      {file && script && (
        <div className="mt-2">
          <ScriptPreview file={file} maxHeight="max-h-64" />
        </div>
      )}
    </div>
  );
}

/** What this terminal's agent left for the user, at the foot of its card: every item at once, never one after another. */
export function AskBar({ ptyId }: { ptyId: string }) {
  const items = useWaitingStore(useShallow((s) => s.items.filter((i) => i.from === ptyId)));
  if (items.length === 0) return null;
  const pending = items.filter(undecided);
  const declineAll = () => {
    for (const item of pending) useWaitingStore.getState().remove(item.id);
  };
  return (
    <section
      aria-label="Waiting on you"
      className="shrink-0 mx-2.5 mb-2.5 rounded-[10px] bg-ink/[0.035] border border-ink/[0.08] flex flex-col max-h-[45%] overflow-hidden"
    >
      {pending.length > 1 && (
        <div className="shrink-0 flex items-center gap-3.5 px-3 pt-2 pb-1 text-xs">
          <span className="flex-1 text-text-secondary">{pending.length} waiting on you</span>
          <button type="button" className={LINK} onClick={declineAll}>
            Decline all
          </button>
          <button
            type="button"
            className="text-xs font-medium text-accent hover:opacity-80 transition-opacity duration-100"
            onClick={() => pending.forEach(runWaiting)}
          >
            Run all
          </button>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto px-1 py-0.5">
        {items.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function TerminalEntry({ ptyId, items, onPick }: { ptyId: string; items: Waiting[]; onPick: () => void }) {
  const label = useTerminalStore((s) => s.displayStates[ptyId]?.label ?? 'A terminal');
  return (
    <button
      type="button"
      className="w-full text-left px-2.5 py-1.5 rounded-[7px] flex items-center gap-2.5 hover:bg-ink/[0.08] transition-colors duration-100"
      onClick={onPick}
    >
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-sm text-text-primary truncate">{label}</span>
        <span className="font-mono text-[11px] text-text-tertiary truncate">{items.map(commandOf).join(', ')}</span>
      </span>
      <span className="text-xs text-text-tertiary tabular-nums">{items.length}</span>
    </button>
  );
}

/** A count of what waits on the user in the title bar, listing the terminals it waits on. */
export function WaitingQueue() {
  const items = useWaitingStore((s) => s.items);
  const [open, setOpen] = useState(false);
  usePruneAsks();
  useNextShortcut();

  const count = items.filter((i) => i.kind === 'move' || i.ran?.status !== 'running').length;
  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);
  if (count === 0) return null;

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      className="w-80 max-h-[24rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-9 px-3 ml-3 flex items-center gap-2 bg-background-secondary glass-bevel relative border border-bezel rounded-[14px] text-[13px] text-text-secondary transition-all duration-150 ease-out [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary"
          onClick={() => setOpen(!open)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {count} waiting
        </button>
      )}
    >
      {waitingTerminals(items).map((ptyId) => (
        <TerminalEntry
          key={ptyId}
          ptyId={ptyId}
          items={items.filter((i) => i.from === ptyId)}
          onPick={() => {
            setOpen(false);
            void focusTerminal(ptyId);
          }}
        />
      ))}
      <div className="mt-1 px-2.5 pt-1.5 pb-1 border-t border-separator text-[11px] text-text-tertiary">
        {isMac ? '⌘J' : 'Ctrl+J'} for the next
      </div>
    </MenuPopover>
  );
}
