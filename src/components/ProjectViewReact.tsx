import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore, getTerminalIndexByStackPosition, STACK_PAGE_SIZE } from '../stores/terminalStore';
import { TerminalCardStack } from './terminal/TerminalCardStack';
import { addProjectTerminal, closeProjectTerminal, reconnectOrphanedSessions } from './terminal/terminalActions';
import { terminalInstances, refreshAllTerminalGitStatus } from './terminal/terminalReact';

const isMac = navigator.platform.toLowerCase().includes('mac');
const GIT_STATUS_PERIODIC_INTERVAL = 30000;
const EMPTY: string[] = [];

export function ProjectView() {
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const projectData = useAppStore((s) => s.activeProjectData);

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
        return;
      }

      // Cmd+W — close active terminal
      if (key === 'w') {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const terminals = store.terminalsByProject[projectPath] ?? [];
        const activeIdx = store.activeIndices[projectPath] ?? 0;
        const activePtyId = terminals[activeIdx];
        if (activePtyId) closeProjectTerminal(activePtyId);
        return;
      }

      // Cmd+1-9 — switch to stacked terminal by position
      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const targetIndex = getTerminalIndexByStackPosition(projectPath, num);
        if (targetIndex !== -1) {
          useTerminalStore.getState().setActiveIndex(projectPath, targetIndex);
        }
        return;
      }

      // Cmd+Shift+Left/Right — page navigation
      if (e.shiftKey && (key === 'arrowleft' || key === 'arrowright')) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const terminals = store.terminalsByProject[projectPath] ?? [];
        const currentIndex = store.activeIndices[projectPath] ?? 0;
        const currentPage = Math.floor(currentIndex / STACK_PAGE_SIZE);
        const totalPages = Math.max(1, Math.ceil(terminals.length / STACK_PAGE_SIZE));
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

  // Reconnect orphaned sessions on mount
  useEffect(() => {
    if (!projectPath) return;

    // Only reconnect if no terminals exist for this project yet
    const existing = useTerminalStore.getState().terminalsByProject[projectPath];
    if (!existing || existing.length === 0) {
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

  // Seed hook status for existing terminals
  useEffect(() => {
    if (!projectPath) return;

    const terminals = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
    for (const ptyId of terminals) {
      const instance = terminalInstances.get(ptyId);
      if (!instance) continue;

      window.api.claudeHooks.getStatus(ptyId).then((hookStatus) => {
        if (hookStatus?.status === 'thinking' && hookStatus.thinkingCount > 0) {
          instance.handleHookStatus('thinking');
        }
      });
    }
  }, [projectPath]);

  // Focus active terminal when view mounts or active index changes
  const activeIndex = useTerminalStore((s) => (projectPath ? (s.activeIndices[projectPath] ?? 0) : 0));
  const terminalList = useTerminalStore((s) => (projectPath ? s.terminalsByProject[projectPath] : undefined));
  const terminals = terminalList ?? EMPTY;

  useEffect(() => {
    if (!projectPath || terminals.length === 0) return;
    const activePtyId = terminals[activeIndex];
    if (!activePtyId) return;

    const instance = terminalInstances.get(activePtyId);
    if (instance) {
      requestAnimationFrame(() => {
        instance.fit();
        instance.xterm.focus();
      });
    }
  }, [activeIndex, terminals, projectPath]);

  if (!projectPath || !projectData) {
    return <div className="project-view-empty">No project selected</div>;
  }

  return (
    <div className="project-view">
      <TerminalCardStack projectPath={projectPath} />
    </div>
  );
}
