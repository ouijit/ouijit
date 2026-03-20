import { useEffect, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useTerminalStore, getTerminalIndexByStackPosition, STACK_PAGE_SIZE } from '../stores/terminalStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { KanbanBoard } from './kanban/KanbanBoard';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import {
  addProjectTerminal,
  closeProjectTerminal,
  reconnectOrphanedSessions,
  spawnRunner,
} from './terminal/terminalActions';
import { terminalInstances, refreshAllTerminalGitStatus } from './terminal/terminalReact';

const isMac = navigator.platform.toLowerCase().includes('mac');
const GIT_STATUS_PERIODIC_INTERVAL = 30000;
const EMPTY: string[] = [];

export function ProjectView() {
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const projectData = useAppStore((s) => s.activeProjectData);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);

  const activeIndex = useTerminalStore((s) => (projectPath ? (s.activeIndices[projectPath] ?? 0) : 0));
  const terminalList = useTerminalStore((s) => (projectPath ? s.terminalsByProject[projectPath] : undefined));
  const terminals = terminalList ?? EMPTY;

  // Keyboard shortcuts for project mode
  useEffect(() => {
    if (!projectPath) return;

    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      const key = e.key.toLowerCase();

      // Cmd+I — spawn shell terminal
      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        addProjectTerminal(projectPath);
        useProjectStore.getState().setKanbanVisible(false);
        return;
      }

      // Cmd+W — close active terminal
      if (key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        const store = useTerminalStore.getState();
        const terms = store.terminalsByProject[projectPath] ?? [];
        const activeIdx = store.activeIndices[projectPath] ?? 0;
        const ptyId = terms[activeIdx];
        if (ptyId) closeProjectTerminal(ptyId);
        return;
      }

      // Cmd+N — show kanban board and focus new task input
      if (key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        useProjectStore.getState().setKanbanVisible(true);
        requestAnimationFrame(() => focusKanbanAddInput());
        return;
      }

      // Cmd+T — toggle kanban board / terminal stack
      if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        useProjectStore.getState().toggleKanban();
        return;
      }

      // Cmd+P — play or toggle runner for active terminal
      if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        const pStore = useTerminalStore.getState();
        const pTerms = pStore.terminalsByProject[projectPath] ?? [];
        const pIdx = pStore.activeIndices[projectPath] ?? 0;
        const pPtyId = pTerms[pIdx];
        if (pPtyId) {
          const inst = terminalInstances.get(pPtyId);
          if (inst) {
            if (inst.runner?.ptyId) {
              inst.runnerPanelOpen = !inst.runnerPanelOpen;
              if (inst.runnerPanelOpen && inst.diffPanelOpen) {
                inst.diffPanelOpen = false;
                inst.pushDisplayState({ runnerPanelOpen: true, diffPanelOpen: false });
              } else {
                inst.pushDisplayState({ runnerPanelOpen: inst.runnerPanelOpen });
              }
            } else {
              spawnRunner(pPtyId);
            }
            useProjectStore.getState().setKanbanVisible(false);
          }
        }
        return;
      }

      // Cmd+D — toggle diff panel for active terminal
      if (key === 'd') {
        e.preventDefault();
        e.stopPropagation();
        const tStore = useTerminalStore.getState();
        const tTerms = tStore.terminalsByProject[projectPath] ?? [];
        const tIdx = tStore.activeIndices[projectPath] ?? 0;
        const tPtyId = tTerms[tIdx];
        if (tPtyId) {
          const inst = terminalInstances.get(tPtyId);
          if (inst) {
            inst.diffPanelOpen = !inst.diffPanelOpen;
            inst.pushDisplayState({ diffPanelOpen: inst.diffPanelOpen });
            if (inst.diffPanelOpen) useProjectStore.getState().setKanbanVisible(false);
          }
        }
        return;
      }

      // Cmd+1-9 — switch to stacked terminal by position
      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        e.stopPropagation();
        const targetIndex = getTerminalIndexByStackPosition(projectPath, num);
        if (targetIndex !== -1) {
          useTerminalStore.getState().setActiveIndex(projectPath, targetIndex);
        }
        return;
      }

      // Cmd+Shift+Left/Right — page navigation
      if (e.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
        e.preventDefault();
        e.stopPropagation();
        const store = useTerminalStore.getState();
        const terms = store.terminalsByProject[projectPath] ?? [];
        const currentIndex = store.activeIndices[projectPath] ?? 0;
        const currentPage = Math.floor(currentIndex / STACK_PAGE_SIZE);
        const totalPages = Math.max(1, Math.ceil(terms.length / STACK_PAGE_SIZE));
        const direction = key === 'arrowleft' ? -1 : 1;
        const targetPage = currentPage + direction;
        if (targetPage >= 0 && targetPage < totalPages) {
          store.setActiveIndex(projectPath, targetPage * STACK_PAGE_SIZE);
        }
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [projectPath]);

  // Show kanban on first entry (no existing terminals), matching original UX
  useEffect(() => {
    if (!projectPath) return;
    const existing = useTerminalStore.getState().terminalsByProject[projectPath];
    if (!existing || existing.length === 0) {
      useProjectStore.getState().setKanbanVisible(true);
      reconnectOrphanedSessions(projectPath);
    }
  }, [projectPath]);

  // Periodic git status refresh
  useEffect(() => {
    if (!projectPath) return;
    const interval = setInterval(() => {
      refreshAllTerminalGitStatus(projectPath);
    }, GIT_STATUS_PERIODIC_INTERVAL);
    return () => clearInterval(interval);
  }, [projectPath]);

  // Hook status: register ongoing listener + seed existing terminals
  useEffect(() => {
    if (!projectPath) return;

    // Ongoing listener for hook status events
    const cleanup = window.api.claudeHooks.onStatus((ptyId, status) => {
      const instance = terminalInstances.get(ptyId);
      if (instance) {
        instance.handleHookStatus(status as 'thinking' | 'ready');
      }
    });

    // Seed existing terminals with current hook status
    const terms = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
    for (const ptyId of terms) {
      const instance = terminalInstances.get(ptyId);
      if (!instance) continue;
      window.api.claudeHooks.getStatus(ptyId).then((hookStatus) => {
        if (hookStatus?.status === 'thinking' && hookStatus.thinkingCount > 0) {
          instance.handleHookStatus('thinking');
        }
      });
    }

    return cleanup;
  }, [projectPath]);

  // Focus active terminal when active index changes
  useEffect(() => {
    if (!projectPath || terminals.length === 0 || kanbanVisible) return;
    const ptyId = terminals[activeIndex];
    if (!ptyId) return;
    const instance = terminalInstances.get(ptyId);
    if (instance) {
      requestAnimationFrame(() => {
        instance.fit();
        instance.xterm.focus();
      });
    }
  }, [activeIndex, terminals, projectPath, kanbanVisible]);

  const handleHideKanban = useCallback(() => {
    useProjectStore.getState().setKanbanVisible(false);
  }, []);

  if (!projectPath || !projectData) {
    return <div className="project-view-empty">No project selected</div>;
  }

  return (
    <div className="project-view">
      {kanbanVisible && <KanbanBoard projectPath={projectPath} onHide={handleHideKanban} />}
      {!kanbanVisible && <TerminalCardStack projectPath={projectPath} />}
    </div>
  );
}
