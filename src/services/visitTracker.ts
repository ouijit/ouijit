/**
 * Feeds palette frecency from what is on screen, not from the gestures that put
 * it there. A board showing is a visit to its project; a foregrounded shell is a
 * visit to its task. Recording per gesture instead counts things the user never
 * looked at — a card dragged between columns — and misses every arrival by a
 * route nobody instrumented.
 *
 * Installed once, for the life of the renderer.
 */

import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { useGithubStore } from '../stores/githubStore';
import { projectKey, pullFrecencyKey, recordVisit, terminalFrecencyKey } from '../utils/paletteFrecency';

/** Passing through a view on the way somewhere else is not a visit. */
const DWELL_MS = 1200;

type View =
  | { kind: 'terminal'; ptyId: string }
  | { kind: 'pull'; projectPath: string; prNumber: number }
  | { kind: 'project'; projectPath: string }
  | null;

/**
 * What the user is looking at. The one place that decides; both the cheap
 * change-detection identity and the frecency key derive from it, so they cannot
 * disagree about which of two stacked surfaces is on top.
 */
function currentView(): View {
  const { activeView, activeProjectPath } = useAppStore.getState();
  if (activeView === 'home') {
    const ptyId = useUIStore.getState().homeActivePtyId;
    return ptyId ? { kind: 'terminal', ptyId } : null;
  }
  if (!activeProjectPath) return null;

  const project = useProjectStore.getState();
  // The board covers whichever panel is selected behind it.
  if (project.kanbanVisible) return { kind: 'project', projectPath: activeProjectPath };

  if (project.activePanel === 'pull-requests') {
    const github = useGithubStore.getState();
    if (github.projectPath === activeProjectPath && github.activeNumber != null) {
      return { kind: 'pull', projectPath: activeProjectPath, prNumber: github.activeNumber };
    }
  } else if (project.activePanel === 'terminals') {
    const store = useTerminalStore.getState();
    const ptyIds = store.terminalsByProject[activeProjectPath] ?? [];
    const ptyId = ptyIds[store.activeIndices[activeProjectPath] ?? 0];
    if (ptyId) return { kind: 'terminal', ptyId };
  }
  return { kind: 'project', projectPath: activeProjectPath };
}

/** Compared on every store change, so it must not resolve task identity. */
function identity(view: View): string | null {
  if (!view) return null;
  if (view.kind === 'terminal') return `terminal:${view.ptyId}`;
  if (view.kind === 'pull') return `pull:${view.projectPath}#${view.prNumber}`;
  return `project:${view.projectPath}`;
}

/**
 * Resolved once the view has settled, so a shell whose project was still
 * loading its tasks on arrival still keys on the task that owns it.
 */
function visitKey(view: View): string | null {
  if (!view) return null;
  const { taskCacheByProject } = useAppStore.getState();
  if (view.kind === 'pull') return pullFrecencyKey(view.projectPath, view.prNumber, taskCacheByProject);
  if (view.kind === 'project') return projectKey(view.projectPath);
  const display = useTerminalStore.getState().displayStates[view.ptyId];
  return display ? terminalFrecencyKey(view.ptyId, display, taskCacheByProject) : null;
}

let lastIdentity: string | null = null;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;

function onViewChanged(): void {
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
}

export function installVisitTracker(): () => void {
  const stores = [useAppStore, useProjectStore, useTerminalStore, useUIStore, useGithubStore];
  const unsubscribes = stores.map((store) => store.subscribe(onViewChanged));
  onViewChanged();
  return () => {
    unsubscribes.forEach((off) => off());
    if (dwellTimer) clearTimeout(dwellTimer);
    dwellTimer = null;
    lastIdentity = null;
  };
}
