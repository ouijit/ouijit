import { useEffect, useState, useMemo, useRef } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { terminalInstances } from './terminal/terminalReact';
import { reconnectTerminal, addProjectTerminal } from './terminal/terminalActions';
import { TerminalHeader } from './terminal/TerminalHeader';
import { XTermContainer } from './terminal/XTermContainer';
import { Icon } from './terminal/Icon';
import { stringToColor, getInitials } from '../utils/projectIcon';
import type { Project } from '../types';

/** Inline depth positioning for home view cards — no CSS class dependency */
function getDepthStyle(depth: number): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: `${depth}%`,
    right: `${depth}%`,
    zIndex: 10 - depth,
    transform: `translateY(-${depth * 24}px)`,
    contain: 'layout style paint',
    transition: 'transform 200ms ease-out, left 200ms ease-out, right 200ms ease-out',
  };
}

export function HomeView() {
  const [projects, setProjects] = useState<Map<string, Project>>(new Map());
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);

  const allPtyIds = useMemo(() => {
    const ids: string[] = [];
    for (const ptyIds of Object.values(terminalsByProject)) {
      ids.push(...ptyIds);
    }
    return ids;
  }, [terminalsByProject]);

  const [homeActiveIndex, setHomeActiveIndex] = useState(0);
  const reconnectedRef = useRef(false);

  useEffect(() => {
    if (homeActiveIndex >= allPtyIds.length && allPtyIds.length > 0) {
      setHomeActiveIndex(allPtyIds.length - 1);
    }
  }, [allPtyIds.length, homeActiveIndex]);

  useEffect(() => {
    window.api.getProjects().then((projs) => {
      setProjects(new Map(projs.map((p) => [p.path, p])));
    });
  }, []);

  // Reconnect orphaned sessions
  useEffect(() => {
    if (reconnectedRef.current) return;
    if (allPtyIds.length > 0) return;
    reconnectedRef.current = true;

    (async () => {
      let sessions;
      try {
        sessions = await window.api.pty.getActiveSessions();
      } catch {
        return;
      }
      if (sessions.length === 0) return;

      for (const session of sessions) {
        if (terminalInstances.has(session.ptyId)) continue;
        let worktreeBranch: string | undefined;
        if (session.taskId != null) {
          const task = await window.api.task.getByNumber(session.projectPath, session.taskId);
          worktreeBranch = task?.branch;
        }
        const hookStatus = await window.api.claudeHooks.getStatus(session.ptyId);
        const initialStatus = hookStatus?.status === 'thinking' ? ('thinking' as const) : ('ready' as const);
        await reconnectTerminal(session, { worktreeBranch, initialStatus });
      }
    })();
  }, [allPtyIds.length]);

  const activePtyId = allPtyIds[homeActiveIndex];
  const activeDisplay = activePtyId ? displayStates[activePtyId] : null;

  type StackItem =
    | { type: 'terminal'; ptyId: string; depth: number; globalIndex: number }
    | { type: 'divider'; label: string; icon: 'project' | 'tag'; projectPath?: string; depth: number };

  const { stackItems, orderedGroups } = useMemo(() => {
    type Group = { key: string; label: string; icon: 'project' | 'tag'; projectPath?: string; ptyIds: string[] };
    const groups: Group[] = [];
    const seen = new Map<string, number>();

    for (const ptyId of allPtyIds) {
      const display = displayStates[ptyId];
      if (!display) continue;

      let groupKey: string;
      let groupLabel: string;
      let groupIcon: 'project' | 'tag';
      let projectPath: string | undefined;

      if (homeGroupMode === 'tag') {
        const tag = display.tags.length > 0 ? display.tags[0] : null;
        groupKey = tag ? `tag:${tag.toLowerCase()}` : 'tag:__untagged__';
        groupLabel = tag ?? 'Untagged';
        groupIcon = 'tag';
      } else {
        groupKey = `project:${display.projectPath}`;
        groupLabel = display.projectPath;
        groupIcon = 'project';
        projectPath = display.projectPath;
      }

      const idx = seen.get(groupKey);
      if (idx !== undefined) {
        groups[idx].ptyIds.push(ptyId);
      } else {
        seen.set(groupKey, groups.length);
        groups.push({ key: groupKey, label: groupLabel, icon: groupIcon, projectPath, ptyIds: [ptyId] });
      }
    }

    let activeGroupKey: string | null = null;
    if (activeDisplay) {
      if (homeGroupMode === 'tag') {
        const tag = activeDisplay.tags.length > 0 ? activeDisplay.tags[0] : null;
        activeGroupKey = tag ? `tag:${tag.toLowerCase()}` : 'tag:__untagged__';
      } else {
        activeGroupKey = `project:${activeDisplay.projectPath}`;
      }
    }

    const ordered = activeGroupKey
      ? [...groups.filter((g) => g.key === activeGroupKey), ...groups.filter((g) => g.key !== activeGroupKey)]
      : groups;

    const items: StackItem[] = [];
    let depth = 0;
    for (const group of ordered) {
      for (const ptyId of group.ptyIds) {
        const globalIndex = allPtyIds.indexOf(ptyId);
        if (globalIndex === homeActiveIndex) continue;
        depth++;
        items.push({ type: 'terminal', ptyId, depth, globalIndex });
      }
      depth++;
      items.push({ type: 'divider', label: group.label, icon: group.icon, projectPath: group.projectPath, depth });
    }

    return { stackItems: items, orderedGroups: ordered };
  }, [allPtyIds, displayStates, homeGroupMode, activeDisplay, homeActiveIndex]);

  const maxDepth = stackItems.length > 0 ? stackItems[stackItems.length - 1].depth : 0;

  const stackTop = 82 + maxDepth * 24;

  useEffect(() => {
    if (!activePtyId) return;
    const instance = terminalInstances.get(activePtyId);
    if (instance) {
      requestAnimationFrame(() => {
        instance.fit();
        instance.xterm.focus();
      });
    }
  }, [activePtyId]);

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      // Cmd+I — new terminal
      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        window.api.homePath().then((homePath) => addProjectTerminal(homePath));
        return;
      }

      if (key === 'w' && activePtyId) {
        e.preventDefault();
        e.stopPropagation();
        const instance = terminalInstances.get(activePtyId);
        if (instance) instance.dispose();
        useTerminalStore.getState().removeTerminal(activePtyId);
        return;
      }

      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        e.stopPropagation();
        const termItems = stackItems.filter((i) => i.type === 'terminal') as Array<{
          type: 'terminal';
          globalIndex: number;
        }>;
        const reversed = [...termItems].reverse();
        if (num <= reversed.length) {
          setHomeActiveIndex(reversed[num - 1].globalIndex);
        }
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [activePtyId, stackItems]);

  // Build depth map: ptyId → depth (active = 0, others from stackItems)
  const depthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (activePtyId) map.set(activePtyId, 0);
    for (const item of stackItems) {
      if (item.type === 'terminal') {
        map.set(item.ptyId, item.depth);
      }
    }
    return map;
  }, [activePtyId, stackItems]);

  // Dividers extracted from stackItems
  const dividers = useMemo(
    () =>
      stackItems.filter((i) => i.type === 'divider') as Array<
        Extract<(typeof stackItems)[number], { type: 'divider' }>
      >,
    [stackItems],
  );

  if (allPtyIds.length === 0) {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    return (
      <div className="project-stack" style={{ top: '82px' }}>
        <div className="project-stack-empty project-stack-empty--visible">
          <div className="project-stack-empty-message">No active sessions</div>
          <div className="project-stack-empty-hints">
            <span className="project-stack-empty-hint">
              <span className="project-stack-empty-hint-shortcut">
                {isMac ? '\u2318' : 'Ctrl+'}
                <span className="shortcut-number">I</span>
              </span>
              New Terminal
            </span>
          </div>
        </div>
      </div>
    );
  }

  const handleClose = (ptyId: string) => {
    const instance = terminalInstances.get(ptyId);
    if (instance) instance.dispose();
    useTerminalStore.getState().removeTerminal(ptyId);
  };

  return (
    <div className="project-stack" style={{ top: `${stackTop}px` }}>
      {/* All terminals — stable keys, depth changes animate via transition */}
      {allPtyIds.map((ptyId, globalIndex) => {
        const depth = depthMap.get(ptyId) ?? 0;
        const isActive = globalIndex === homeActiveIndex;
        return (
          <div
            key={ptyId}
            className={`project-card${isActive ? ' project-card--active' : ''}`}
            style={getDepthStyle(depth)}
            onClick={() => !isActive && setHomeActiveIndex(globalIndex)}
          >
            <TerminalHeader ptyId={ptyId} isActive={isActive} compact={!isActive} onClose={() => handleClose(ptyId)} />
            <div className="project-card-body">
              <XTermContainer ptyId={ptyId} />
            </div>
          </div>
        );
      })}

      {/* Dividers */}
      {dividers.map((item) => {
        const project = item.projectPath ? projects.get(item.projectPath) : undefined;
        const isRegisteredProject = item.icon === 'project' && project != null;
        const name = item.icon === 'project' ? project?.name || 'Shell' : item.label;

        return (
          <div
            key={`divider-${item.label}`}
            className="project-card home-folder-divider"
            style={getDepthStyle(item.depth)}
            onClick={() => {
              const group = orderedGroups.find((g) => g.label === item.label || g.projectPath === item.projectPath);
              if (group && group.ptyIds.length > 0) {
                setHomeActiveIndex(allPtyIds.indexOf(group.ptyIds[0]));
              }
            }}
          >
            <div className="home-folder-tab">
              <svg viewBox="0 0 234 28" width="234" height="28">
                <path
                  d="M 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5 L 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 Z"
                  fill="#252528"
                />
                <path
                  d="M 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5"
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1"
                />
              </svg>
              <div className="home-folder-tab-content">
                {item.icon === 'tag' ? (
                  <span
                    className="home-folder-icon"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="tag" />
                  </span>
                ) : isRegisteredProject ? (
                  project?.iconDataUrl ? (
                    <img className="home-folder-icon" src={project.iconDataUrl} alt={name} draggable={false} />
                  ) : (
                    <span
                      className="home-folder-icon home-folder-icon-placeholder"
                      style={{ backgroundColor: stringToColor(name) }}
                    >
                      {getInitials(name)}
                    </span>
                  )
                ) : (
                  <span
                    className="home-folder-icon"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="terminal" />
                  </span>
                )}
                <span className="home-folder-name">{name}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
