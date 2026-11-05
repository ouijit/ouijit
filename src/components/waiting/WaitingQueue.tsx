import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../stores/appStore';
import { getActivePtyId, useTerminalStore } from '../../stores/terminalStore';
import { undecided, useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { focusTerminal } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { MenuPopover } from '../ui/Menu';
import { formatAge } from '../../utils/formatDate';
import { isActiveSandbox } from '../../types';
import { scriptRisks } from './ScriptPreview';
import { ScriptDialog } from './ScriptDialog';

const isMac = navigator.platform.toLowerCase().includes('mac');

/** What running a held hook does to its task, in a word. */
const HOOK_VERB: Record<string, string> = {
  start: 'Start',
  continue: 'Resume',
  review: 'Review',
  done: 'Finish',
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
    ...((item.kind === 'ask' ? sandboxed : item.outsideSandbox) ? ['outside its sandbox'] : []),
    ...(item.kind === 'ask' ? scriptRisks(item.ask.file).map((r) => r.toLowerCase()) : []),
  ];
}

/** The resume banner's buttons: the app's calls to action, as against its tabs and toggles. */
const SECONDARY =
  'px-3 py-1 text-xs text-text-secondary rounded-full hover:bg-ink/[0.05] transition-colors duration-100 shrink-0';
/** A row's Run beside others: plain, so the one blue button is Run all. */
const SECONDARY_RUN =
  'px-3 py-1 text-xs font-medium text-text-primary rounded-full hover:bg-ink/[0.05] transition-colors duration-100 shrink-0';
const PRIMARY =
  'px-3.5 py-1 text-xs font-medium text-accent-ink bg-accent rounded-full hover:bg-accent-hover active:scale-[0.98] transition-all duration-150 shrink-0';
const LINK = 'text-[11px] text-text-tertiary hover:text-text-secondary transition-colors duration-100 shrink-0';

function asked(ms: number): string {
  const age = formatAge(ms / 1000);
  return age === 'now' ? 'Asked just now' : `Asked ${age} ago`;
}

/** `lead`: the row's Run is the bar's main action, as it is when nothing else waits beside it. */
function Row({ item, lead }: { item: Waiting; lead: boolean }) {
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
  const why = item.kind === 'ask' ? (item.ask.message ?? asked(Date.now() - item.at)) : null;
  const showRunner = () => {
    if (ran) terminalInstances.get(item.from)?.activatePanel(ran.panelId);
  };

  return (
    <div data-testid="waiting-row" className="px-4 py-2 border-t border-separator first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          {item.kind === 'move' ? (
            <>
              <span className="text-[13px] text-text-primary truncate">
                {HOOK_VERB[item.hookType] ?? 'Move'} {taskName}
              </span>
              <span className="text-[11px] text-text-tertiary truncate">
                {item.hookName || `${HOOK_VERB[item.hookType] ?? 'Its'} hook`}:{' '}
                <span data-testid="waiting-command" className="font-mono">
                  {item.command}
                </span>
              </span>
            </>
          ) : (
            <span data-testid="waiting-command" className="font-mono text-[12px] text-text-primary truncate">
              {item.ask.command}
            </span>
          )}
          <span className={`text-[11px] text-text-tertiary truncate ${why || risks.length ? '' : 'hidden'}`}>
            {why}
            {risks.map((risk, i) => (
              <span key={risk}>
                {why || i > 0 ? ' · ' : ''}
                <span className="text-error">{risk}</span>
              </span>
            ))}
          </span>
        </span>
        {ran?.status === 'running' && <span className="text-[11px] text-text-tertiary shrink-0">Running…</span>}
        {ran?.status === 'failed' && (
          <span className="text-[11px] text-error shrink-0">
            Failed{ran.exitCode != null && `, exit ${ran.exitCode}`}
          </span>
        )}
        {file && !ran && (
          <button type="button" className={LINK} onClick={() => setScript(true)}>
            Script
          </button>
        )}
        <span className="flex items-center gap-1 shrink-0">
          {ran
            ? [
                <button key="runner" type="button" className={SECONDARY} onClick={showRunner}>
                  Show runner
                </button>,
                ...(ran.status === 'failed'
                  ? [
                      <button key="dismiss" type="button" className={SECONDARY} onClick={() => remove(item.id)}>
                        Dismiss
                      </button>,
                    ]
                  : []),
              ]
            : [
                <button key="decline" type="button" className={SECONDARY} onClick={() => remove(item.id)}>
                  {item.kind === 'ask' ? 'Decline' : 'Skip'}
                </button>,
                <button
                  key="run"
                  type="button"
                  className={lead ? PRIMARY : SECONDARY_RUN}
                  onClick={() => runWaiting(item)}
                >
                  Run
                </button>,
              ]}
        </span>
      </div>
      {item.kind === 'ask' && script && (
        <ScriptDialog item={item} onRun={() => runWaiting(item)} onClose={() => setScript(false)} />
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
      className="pane-seam-top shrink-0 flex flex-col max-h-[45%] overflow-hidden"
      style={{ background: 'var(--color-terminal-bg)' }}
    >
      {pending.length > 1 && (
        <div className="shrink-0 flex items-center gap-2 px-4 pt-2.5 pb-1">
          <span className="flex-1 text-[11px] text-ink/40">{pending.length} waiting on you</span>
          <span className="flex items-center gap-1 shrink-0">
            <button type="button" className={SECONDARY} onClick={declineAll}>
              Decline all
            </button>
            <button type="button" className={PRIMARY} onClick={() => pending.forEach(runWaiting)}>
              Run all
            </button>
          </span>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto settings-scrollable pb-1">
        {items.map((item) => (
          <Row key={item.id} item={item} lead={pending.length === 1} />
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
