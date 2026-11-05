import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { launchesAgent, undecided, useWaitingStore, type Waiting } from '../../stores/waitingStore';
import { focusTerminal } from '../navigation';
import { terminalInstances } from '../terminal/terminalRegistry';
import { DialogOverlay } from '../dialogs/DialogOverlay';
import { showTask } from '../../links/openLink';
import { formatAge } from '../../utils/formatDate';
import { isActiveSandbox } from '../../types';

const isMac = navigator.platform.toLowerCase().includes('mac');
const LIST_KEYS = isMac ? '⌘J' : 'Ctrl+J';

/** Past this, a command shows its first lines until asked for the rest. */
const LONG_COMMAND = 160;

const HOOK_NAMES: Record<string, string> = {
  start: 'Start hook',
  continue: 'Continue hook',
  review: 'Review hook',
  done: 'Done hook',
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

function useListShortcut(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || !(isMac ? e.metaKey : e.ctrlKey) || e.key.toLowerCase() !== 'j') return;
      const { items, listOpen, setListOpen } = useWaitingStore.getState();
      if (items.length === 0 && !listOpen) return;
      e.preventDefault();
      e.stopPropagation();
      setListOpen(!listOpen);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

interface Group {
  key: string;
  title: string;
  open: () => void;
  items: Waiting[];
}

/** Items by the task they belong to, or the terminal for one that has none, in the order the first of each arrived. */
function useGroups(items: Waiting[]): Group[] {
  const displays = useTerminalStore((s) => s.displayStates);
  const tasks = useAppStore((s) => s.taskCacheByProject);
  return useMemo(() => {
    const groups = new Map<string, Group>();
    for (const item of items) {
      const display = displays[item.from];
      const task =
        item.kind === 'move'
          ? { projectPath: item.projectPath, taskNumber: item.taskNumber }
          : display?.taskId != null
            ? { projectPath: display.projectPath, taskNumber: display.taskId }
            : null;
      const key = task ? `task:${task.projectPath}:${task.taskNumber}` : `terminal:${item.from}`;
      let group = groups.get(key);
      if (!group) {
        const name = task
          ? (tasks[task.projectPath]?.find((t) => t.taskNumber === task.taskNumber)?.name ?? `T-${task.taskNumber}`)
          : (display?.label ?? 'A terminal');
        group = {
          key,
          title: name,
          open: task ? () => void showTask(task.projectPath, task.taskNumber) : () => void focusTerminal(item.from),
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    return [...groups.values()];
  }, [items, displays, tasks]);
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function Badges({ item }: { item: Waiting }) {
  const sandboxed = useTerminalStore((s) => isActiveSandbox(s.displayStates[item.from]?.sandboxProvider));
  const outside = item.kind === 'ask' ? sandboxed : item.outsideSandbox;
  const agent = launchesAgent(commandOf(item));
  if (!outside && !agent) return null;
  return (
    <span className="flex gap-1 shrink-0">
      {agent && <Badge>Starts an agent</Badge>}
      {outside && <Badge>Outside the sandbox</Badge>}
    </span>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded-full bg-error/10 text-error text-[11px] font-medium whitespace-nowrap">
      {children}
    </span>
  );
}

const SMALL = 'h-6 px-2 rounded-md text-xs font-medium transition-colors duration-100 disabled:opacity-40';
const QUIET = `${SMALL} text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary`;
const PRIMARY = `${SMALL} bg-accent text-accent-ink hover:opacity-90`;

function Checkbox({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="shrink-0 mt-0.5" />;
}

function Command({ item }: { item: Waiting }) {
  const [whole, setWhole] = useState(false);
  const [script, setScript] = useState(false);
  const command = commandOf(item);
  const long = command.length > LONG_COMMAND || command.split('\n').length > 3;
  const file = item.kind === 'ask' ? item.ask.file : undefined;
  return (
    <div className="mt-1.5">
      <pre
        data-testid="waiting-command"
        className={`m-0 px-2 py-1.5 rounded-md bg-ink/[0.05] font-mono text-xs text-text-primary whitespace-pre-wrap break-all ${
          long && !whole ? 'max-h-[4.5em] overflow-hidden' : ''
        }`}
      >
        {command}
      </pre>
      <div className="flex gap-3">
        {long && (
          <button
            type="button"
            className="mt-1 text-xs text-text-tertiary hover:text-text-secondary"
            onClick={() => setWhole(!whole)}
          >
            {whole ? 'Show less' : 'Show all'}
          </button>
        )}
        {file && (
          <button
            type="button"
            className="mt-1 text-xs text-text-tertiary hover:text-text-secondary"
            onClick={() => setScript(!script)}
          >
            {script ? 'Hide' : 'Show'} {file.path.split('/').pop()}
          </button>
        )}
      </div>
      {file && script && (
        <pre className="m-0 mt-1 px-2 py-1.5 rounded-md bg-ink/[0.05] font-mono text-xs text-text-primary whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
          {file.contents}
        </pre>
      )}
    </div>
  );
}

function Row({
  item,
  now,
  selected,
  onSelect,
  onClose,
}: {
  item: Waiting;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const from = useTerminalStore((s) => s.displayStates[item.from]?.label ?? 'A terminal');
  const { remove } = useWaitingStore.getState();
  const kind = item.kind === 'ask' ? 'Command' : (HOOK_NAMES[item.hookType] ?? `${item.hookType} hook`);
  const ran = item.kind === 'ask' ? item.ran : undefined;
  const openSource = () => {
    onClose();
    void focusTerminal(item.from);
  };
  const openRunner = () => {
    if (!ran) return;
    onClose();
    void focusTerminal(item.from).then(() => terminalInstances.get(item.from)?.activatePanel(ran.panelId));
  };
  const open = () => {
    onClose();
    if (item.kind === 'move') void showTask(item.projectPath, item.taskNumber);
    else void focusTerminal(item.from);
  };

  return (
    <div data-testid="waiting-row" className="flex items-start gap-2.5 px-3 py-2.5 rounded-[10px] hover:bg-ink/[0.03]">
      {ran ? (
        <span className="w-[13px] shrink-0" />
      ) : (
        <Checkbox checked={selected} label={`Select: ${commandOf(item)}`} onChange={onSelect} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <span className="font-medium text-text-secondary">{kind}</span>
          <span>·</span>
          <button type="button" className="truncate hover:text-text-primary hover:underline" onClick={openSource}>
            {from}
          </button>
          <span>·</span>
          <span className="shrink-0">{formatAge((now - item.at) / 1000)}</span>
          <span className="flex-1" />
          <Badges item={item} />
        </div>
        {item.kind === 'ask' && item.ask.message && (
          <p className="m-0 mt-1 text-sm leading-5 text-text-primary whitespace-pre-wrap break-words">
            {item.ask.message}
          </p>
        )}
        <Command item={item} />
        <div className="mt-1.5 flex items-center justify-end gap-1">
          {ran?.status === 'running' && <span className="mr-auto text-xs text-text-tertiary">Running…</span>}
          {ran?.status === 'failed' && (
            <span className="mr-auto text-xs text-error">Failed{ran.exitCode != null && `, exit ${ran.exitCode}`}</span>
          )}
          {ran ? (
            <>
              <button type="button" className={QUIET} onClick={openRunner}>
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
              <button type="button" className={QUIET} onClick={open}>
                Open
              </button>
              <button type="button" className={QUIET} onClick={() => remove(item.id)}>
                Decline
              </button>
              <button type="button" className={PRIMARY} onClick={() => runWaiting(item)}>
                Run
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The step before a batch runs: every command it will run, read in one place. */
function Confirm({ items, onBack, onRun }: { items: Waiting[]; onBack: () => void; onRun: () => void }) {
  return (
    <>
      <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
        Run {items.length} {items.length === 1 ? 'command' : 'commands'}?
      </h2>
      <div className="mt-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} data-testid="confirm-row">
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <span>{item.kind === 'ask' ? 'Command' : (HOOK_NAMES[item.hookType] ?? 'Hook')}</span>
              <span className="flex-1" />
              <Badges item={item} />
            </div>
            <pre className="m-0 mt-1 px-2 py-1.5 rounded-md bg-ink/[0.05] font-mono text-xs text-text-primary whitespace-pre-wrap break-all">
              {commandOf(item)}
            </pre>
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-end mt-4">
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back
        </button>
        <button type="button" data-testid="confirm-run" className="btn-primary" onClick={onRun}>
          Run {items.length}
        </button>
      </div>
    </>
  );
}

/** Everything waiting on the user, grouped by task or terminal, to run or decline one at a time or several at once. */
function QueueList() {
  const items = useWaitingStore((s) => s.items);
  const groups = useGroups(items);
  const now = useNow();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState<Waiting[] | null>(null);
  const [visible, setVisible] = useState(false);
  const close = () => useWaitingStore.getState().setListOpen(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // A row that has gone, run or declined elsewhere, is no longer selected.
  const picked = items.filter((i) => selected.has(i.id) && undecided(i));
  const toggle = (ids: number[]) => {
    const next = new Set(selected);
    const all = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (all) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  };
  const decline = (batch: Waiting[]) => {
    for (const item of batch) useWaitingStore.getState().remove(item.id);
    setSelected(new Set());
  };
  const run = (batch: Waiting[]) => {
    for (const item of batch) runWaiting(item);
    setSelected(new Set());
    setConfirming(null);
  };

  return (
    <DialogOverlay visible={visible} onDismiss={confirming ? () => setConfirming(null) : close} maxWidth={640}>
      {confirming ? (
        <Confirm items={confirming} onBack={() => setConfirming(null)} onRun={() => run(confirming)} />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <h2 data-testid="dialog-title" className="text-[17px] font-semibold text-text-primary">
              Waiting on you
            </h2>
            <span className="text-xs text-text-tertiary">{LIST_KEYS}</span>
          </div>
          {items.length === 0 && <p className="mt-3 text-sm text-text-tertiary">Nothing is waiting.</p>}
          <div className="mt-3 -mx-3 flex flex-col gap-3 max-h-[65vh] overflow-y-auto">
            {groups.map((group) => {
              const pending = group.items.filter(undecided);
              const ids = pending.map((i) => i.id);
              return (
                <section key={group.key} aria-label={group.title}>
                  <div className="flex items-center gap-2.5 px-3 py-1">
                    {pending.length > 0 ? (
                      <Checkbox
                        checked={ids.every((id) => selected.has(id))}
                        label={`Select all in ${group.title}`}
                        onChange={() => toggle(ids)}
                      />
                    ) : (
                      <span className="w-[13px] shrink-0" />
                    )}
                    <button
                      type="button"
                      className="min-w-0 truncate text-sm font-semibold text-text-primary hover:underline"
                      onClick={() => {
                        close();
                        group.open();
                      }}
                    >
                      {group.title}
                    </button>
                    <span className="text-xs text-text-tertiary">{group.items.length}</span>
                    <span className="flex-1" />
                    {pending.length > 1 && (
                      <>
                        <button type="button" className={QUIET} onClick={() => decline(pending)}>
                          Decline all
                        </button>
                        <button type="button" className={QUIET} onClick={() => setConfirming(pending)}>
                          Run all
                        </button>
                      </>
                    )}
                  </div>
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      now={now}
                      selected={selected.has(item.id)}
                      onSelect={() => toggle([item.id])}
                      onClose={close}
                    />
                  ))}
                </section>
              );
            })}
          </div>
          <div className="flex items-center gap-2 justify-end mt-4 min-h-[34px]">
            {picked.length > 0 && (
              <>
                <span className="mr-auto text-xs text-text-tertiary">{picked.length} selected</span>
                <button type="button" className="btn-secondary" onClick={() => decline(picked)}>
                  Decline selected
                </button>
                <button type="button" className="btn-primary" onClick={() => setConfirming(picked)}>
                  Run selected
                </button>
              </>
            )}
          </div>
        </>
      )}
    </DialogOverlay>
  );
}

/** A count of what waits on the user in the title bar, opening the list of it. */
export function WaitingQueue() {
  const count = useWaitingStore((s) => s.items.filter((i) => i.kind === 'move' || i.ran?.status !== 'running').length);
  const listOpen = useWaitingStore((s) => s.listOpen);
  usePruneAsks();
  useListShortcut();

  return (
    <>
      {count > 0 && (
        <button
          type="button"
          className="h-9 px-3 ml-3 flex items-center gap-1.5 rounded-[14px] bg-accent text-accent-ink text-[13px] font-medium [-webkit-app-region:no-drag] transition-opacity duration-150 hover:opacity-90"
          onClick={() => useWaitingStore.getState().setListOpen(true)}
        >
          {count} waiting
        </button>
      )}
      {listOpen && <QueueList />}
    </>
  );
}
