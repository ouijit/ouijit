/**
 * Feeds palette frecency from what is on screen, not from the gestures that put
 * it there. A project page showing is a visit to its project; a foregrounded
 * shell is a visit to its task. Recording per gesture instead counts things the
 * user never looked at — a card dragged between columns — and misses every
 * arrival by a route nobody instrumented.
 *
 * Installed once, for the life of the renderer.
 */

import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { getActivePtyId, useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { useGithubStore } from '../stores/githubStore';
import { useLinearStore } from '../stores/linearStore';
import { usePanelStore } from '../stores/panelStore';
import {
  issueKey,
  issueTaskNumber,
  projectKey,
  pullKey,
  pullTaskNumber,
  recordVisit,
  taskKey,
  terminalKey,
  terminalTaskNumber,
} from '../utils/paletteFrecency';

/** Passing through a view on the way somewhere else is not a visit. */
const DWELL_MS = 1200;

type View =
  | { kind: 'terminal'; ptyId: string }
  | { kind: 'pull'; projectPath: string; prNumber: number }
  | { kind: 'issue'; projectPath: string; issueId: string }
  | { kind: 'project'; projectPath: string }
  | null;

function currentView(): View {
  const { selection } = useAppStore.getState();
  if (selection.kind === 'terminal') {
    // The canvas has no single foreground card.
    const onCanvas =
      useProjectStore.getState().terminalLayout === 'canvas' &&
      useExperimentalStore.getState().getFlags(selection.projectPath).canvas;
    if (onCanvas) return { kind: 'project', projectPath: selection.projectPath };
    const ptyId = getActivePtyId(selection.stack);
    return ptyId ? { kind: 'terminal', ptyId } : null;
  }
  if (selection.kind !== 'page') return null;

  const { projectPath } = selection;
  if (selection.page === 'pull-requests') {
    const open = usePanelStore.getState().open;
    if (useGithubStore.getState().projectPath === projectPath && open?.source === 'github-pr') {
      return { kind: 'pull', projectPath, prNumber: open.number };
    }
    // Only Linear's: the palette lists no row for a GitHub issue, and a key
    // recorded against no row takes its boost nowhere.
    if (useLinearStore.getState().projectPath === projectPath && open?.source === 'linear') {
      return { kind: 'issue', projectPath, issueId: open.id };
    }
  }
  return { kind: 'project', projectPath };
}

/** Compared on every store change, so it must not resolve task identity. */
function identity(view: View): string | null {
  if (!view) return null;
  if (view.kind === 'terminal') return terminalKey(view.ptyId);
  if (view.kind === 'pull') return pullKey(view.projectPath, view.prNumber);
  if (view.kind === 'issue') return issueKey(view.projectPath, view.issueId);
  return projectKey(view.projectPath);
}

/**
 * Resolved once the view has settled, so a shell whose project was still
 * loading its tasks on arrival still keys on the task that owns it.
 */
function visitKey(view: View): string | null {
  if (!view) return null;
  const { taskCacheByProject } = useAppStore.getState();
  if (view.kind === 'project') return projectKey(view.projectPath);
  if (view.kind === 'pull') {
    const owner = pullTaskNumber(view.projectPath, view.prNumber, taskCacheByProject);
    return owner == null ? pullKey(view.projectPath, view.prNumber) : taskKey(view.projectPath, owner);
  }
  if (view.kind === 'issue') {
    const owner = issueTaskNumber(view.projectPath, view.issueId, taskCacheByProject);
    return owner == null ? issueKey(view.projectPath, view.issueId) : taskKey(view.projectPath, owner);
  }
  const display = useTerminalStore.getState().displayStates[view.ptyId];
  if (!display) return null;
  const owner = terminalTaskNumber(display, taskCacheByProject);
  return owner == null ? terminalKey(view.ptyId) : taskKey(display.projectPath, owner);
}

export function installVisitTracker(): () => void {
  let lastIdentity: string | null = null;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;

  const onViewChanged = () => {
    const next = identity(currentView());
    if (next === lastIdentity) return;
    lastIdentity = next;
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = null;
    if (!next) return;
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      const key = visitKey(currentView());
      if (key) recordVisit(key);
    }, DWELL_MS);
  };

  const stores = [
    useAppStore,
    useProjectStore,
    useExperimentalStore,
    useTerminalStore,
    useUIStore,
    useGithubStore,
    useLinearStore,
    usePanelStore,
  ];
  const unsubscribes = stores.map((store) => store.subscribe(onViewChanged));
  onViewChanged();
  return () => {
    unsubscribes.forEach((off) => off());
    if (dwellTimer) clearTimeout(dwellTimer);
  };
}
