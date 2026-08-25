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
import { isBoardMounted } from '../stores/composerStore';
import { getActivePtyId, useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { useGithubStore } from '../stores/githubStore';
import {
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
  | { kind: 'project'; projectPath: string }
  | null;

function currentView(): View {
  const { activeView, activeProjectPath } = useAppStore.getState();
  if (activeView === 'home') {
    const ptyId = useUIStore.getState().homeActivePtyId;
    return ptyId ? { kind: 'terminal', ptyId } : null;
  }
  if (!activeProjectPath) return null;

  const project = useProjectStore.getState();
  if (isBoardMounted(project.activePanel, project.kanbanVisible)) {
    return { kind: 'project', projectPath: activeProjectPath };
  }

  if (project.activePanel === 'pull-requests') {
    const github = useGithubStore.getState();
    if (github.projectPath === activeProjectPath && github.activeNumber != null) {
      return { kind: 'pull', projectPath: activeProjectPath, prNumber: github.activeNumber };
    }
  } else if (project.activePanel === 'terminals' && project.terminalLayout !== 'canvas') {
    // The canvas has no single foreground card, and `activeIndices` is not
    // maintained while it is up — reading one there names an arbitrary shell.
    const ptyId = getActivePtyId(activeProjectPath);
    if (ptyId) return { kind: 'terminal', ptyId };
  }
  return { kind: 'project', projectPath: activeProjectPath };
}

/** Compared on every store change, so it must not resolve task identity. */
function identity(view: View): string | null {
  if (!view) return null;
  if (view.kind === 'terminal') return terminalKey(view.ptyId);
  if (view.kind === 'pull') return pullKey(view.projectPath, view.prNumber);
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

  const stores = [useAppStore, useProjectStore, useTerminalStore, useUIStore, useGithubStore];
  const unsubscribes = stores.map((store) => store.subscribe(onViewChanged));
  onViewChanged();
  return () => {
    unsubscribes.forEach((off) => off());
    if (dwellTimer) clearTimeout(dwellTimer);
  };
}
