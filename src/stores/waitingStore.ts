import { create } from 'zustand';
import type { AskRun, HookType } from '../types';

/** A request to run something on the host. It is decided once: run, or declined. */
export interface PendingAsk extends AskRun {
  message?: string;
  run: () => void;
  decline: () => void;
}

/** An ask the user ran, while its runner is still going or after it failed. A run that succeeds leaves the queue. */
export interface AskRunState {
  status: 'running' | 'failed';
  panelId: string;
  exitCode?: number | null;
}

/**
 * What an agent left for the user to decide: a command it asks to run on the
 * host, or a task move whose hook would have opened a dialog over whatever the
 * user was doing.
 */
export type Waiting = { id: number; from: string; at: number } & (
  | { kind: 'ask'; ask: PendingAsk; ran?: AskRunState }
  | {
      kind: 'move';
      projectPath: string;
      taskNumber: number;
      hookType: HookType;
      /** The hook's command, as it will run. */
      command: string;
      /** The hook runs on the host though the agent that moved the task is sandboxed. */
      outsideSandbox: boolean;
      run: () => void;
    }
);

type Unstamped<W> = W extends Waiting ? Omit<W, 'id' | 'at'> : never;
type NewWaiting = Unstamped<Waiting>;

interface WaitingStore {
  items: Waiting[];
  /** The ask open in its own dialog. Closing the dialog leaves it waiting. */
  open: number | null;
  /** Whether the list of everything waiting is open. */
  listOpen: boolean;
  add: (item: NewWaiting) => number;
  /** Take an item off the queue. An ask not yet run is declined. */
  remove: (id: number) => void;
  ran: (id: number, state: AskRunState) => void;
  openAsk: (id: number | null) => void;
  setListOpen: (open: boolean) => void;
}

let nextId = 1;

export const useWaitingStore = create<WaitingStore>()((set, get) => ({
  items: [],
  open: null,
  listOpen: false,
  add: (item) => {
    const id = nextId++;
    set({ items: [...get().items, { ...item, id, at: Date.now() } as Waiting] });
    return id;
  },
  remove: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    if (item.kind === 'ask') item.ask.decline();
    set({ items: get().items.filter((i) => i.id !== id), ...(get().open === id && { open: null }) });
  },
  ran: (id, state) =>
    set({ items: get().items.map((i) => (i.id === id && i.kind === 'ask' ? { ...i, ran: state } : i)) }),
  openAsk: (id) => set({ open: id }),
  setListOpen: (listOpen) => set({ listOpen, ...(listOpen && { open: null }) }),
}));

/** Still the user's to decide: not yet run, nor running. */
export function undecided(item: Waiting): boolean {
  return item.kind === 'move' || !item.ran;
}

/** Terminals whose agent is waiting on an answer to an ask. */
export function askingFrom(items: Waiting[]): string[] {
  return items.flatMap((i) => (i.kind === 'ask' && !i.ran ? [i.from] : []));
}

const AGENT_COMMANDS = new Set(['claude', 'codex', 'pi', 'opencode']);

/** Whether a command starts one of the agent CLIs, anywhere in it: `cd x && claude "$PROMPT"` does. */
export function launchesAgent(command: string): boolean {
  return command.split(/[\s;&|()]+/).some((word) =>
    AGENT_COMMANDS.has(
      word
        .replace(/^["']|["']$/g, '')
        .split('/')
        .pop() ?? '',
    ),
  );
}
