import log from 'electron-log/renderer';
import { OuijitTerminal } from '../terminal/terminalReact';
import type { RegisteredTerminal } from '../terminal/terminalTypes';
import { restoreTerminalOnce, terminalInstances, whenTerminalReady } from '../terminal/terminalRegistry';
import { applyInitialUiState } from '../terminal/terminalActions';
import { uiFor } from '../terminal/sessionSnapshot';
import { DEFAULT_DISPLAY_STATE, useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { homeChatPanelsKey } from '../../chat/preferences';
import { TERMINAL_READY_WAIT_MS, type SnapshotTerminalUi } from '../../types';

const panelsLog = log.scope('homeChatPanels');

/**
 * What holds the panels beside one of Chat's conversations: the same card a
 * task's chat is, so runners, `ouijit ask run` and the panel commands reach it
 * as they reach any card. It is never put in a project's order, so no stack,
 * sidebar row or saved session shows it; the main chat's page does.
 */
export async function homePanelHost(id: string): Promise<RegisteredTerminal | null> {
  await restoreTerminalOnce(id, () => create(id));
  return whenTerminalReady(id, TERMINAL_READY_WAIT_MS);
}

let chatDir: Promise<string> | null = null;

async function create(id: string): Promise<void> {
  chatDir ??= window.api.homeChat.dir();
  const info = useChatStore.getState().sessions[id]?.info ?? (await window.api.chat.snapshot(id))?.info;
  if (!info) throw new Error(`No conversation ${id}`);
  const projectPath = await chatDir;
  const term = new OuijitTerminal({
    ptyId: id,
    projectPath,
    label: info.label ?? 'Chat',
    taskId: null,
    worktreePath: info.cwd,
    surface: 'chat',
    chatAgent: info.agent,
  });
  useTerminalStore.setState((s) => ({
    displayStates: {
      ...s.displayStates,
      [id]: {
        ...DEFAULT_DISPLAY_STATE,
        ptyId: id,
        projectPath,
        label: term.label,
        surface: 'chat',
        taskId: null,
        statusSince: Date.now(),
        lastViewedAt: Date.now(),
      },
    },
  }));
  terminalInstances.set(id, term);
  const stored = await window.api.globalSettings.get(homeChatPanelsKey(id));
  if (stored) {
    try {
      await applyInitialUiState(term, JSON.parse(stored) as SnapshotTerminalUi);
    } catch (error) {
      panelsLog.warn('panels not restored', { id, error: String(error) });
    }
  }
  keepSaved(term);
}

const stopSaving = new Map<string, () => void>();

/** Saved whenever what is open, or which one, changes: they come back with the conversation. */
function keepSaved(term: OuijitTerminal): void {
  let last = JSON.stringify(uiFor(term));
  const unsubscribe = useTerminalStore.subscribe((s, prev) => {
    const now = s.displayStates[term.ptyId];
    const before = prev.displayStates[term.ptyId];
    if (!now || (now.panels === before?.panels && now.activePanelId === before?.activePanelId)) return;
    const ui = JSON.stringify(uiFor(term));
    if (ui === last) return;
    last = ui;
    void window.api.globalSettings.set(homeChatPanelsKey(term.ptyId), ui);
  });
  stopSaving.set(term.ptyId, unsubscribe);
}

/** A conversation deleted takes its panels, and anything they run, with it. */
export function disposeHomePanelHost(id: string): void {
  const term = terminalInstances.get(id);
  if (!term) return;
  stopSaving.get(id)?.();
  stopSaving.delete(id);
  terminalInstances.delete(id);
  term.dispose();
  useTerminalStore.setState((s) => {
    const { [id]: _gone, ...displayStates } = s.displayStates;
    return { displayStates };
  });
}
