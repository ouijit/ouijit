import { useEffect, useState, useMemo } from 'react';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { terminalInstances } from './terminal/terminalReact';
import { TerminalHeader } from './terminal/TerminalHeader';
import { XTermContainer } from './terminal/XTermContainer';
import { Icon } from './terminal/Icon';
import { stringToColor, getInitials } from '../utils/projectIcon';
import type { Project } from '../types';

const CSS_MAX_DEPTH = 8;

/**
 * Home view — cross-project terminal session multiplexer.
 * Shows all active terminals from all projects in a single card stack,
 * grouped by project with folder dividers between groups.
 */
export function HomeView() {
  const [projects, setProjects] = useState<Map<string, Project>>(new Map());
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject);
  const displayStates = useTerminalStore((s) => s.displayStates);

  // Flat list of all ptyIds across all projects
  const allPtyIds = useMemo(() => {
    const ids: string[] = [];
    for (const ptyIds of Object.values(terminalsByProject)) {
      ids.push(...ptyIds);
    }
    return ids;
  }, [terminalsByProject]);

  const [homeActiveIndex, setHomeActiveIndex] = useState(0);

  // Clamp active index
  useEffect(() => {
    if (homeActiveIndex >= allPtyIds.length && allPtyIds.length > 0) {
      setHomeActiveIndex(allPtyIds.length - 1);
    }
  }, [allPtyIds.length, homeActiveIndex]);

  // Load project data for divider labels
  useEffect(() => {
    window.api.getProjects().then((projs) => {
      setProjects(new Map(projs.map((p) => [p.path, p])));
    });
  }, []);

  const homeGroupMode = useUIStore((s) => s.homeGroupMode);

  const activePtyId = allPtyIds[homeActiveIndex];
  const activeDisplay = activePtyId ? displayStates[activePtyId] : null;

  // Group terminals and build stack items based on mode
  type StackItem =
    | { type: 'terminal'; ptyId: string; depth: number; globalIndex: number }
    | { type: 'divider'; label: string; icon: 'project' | 'tag'; projectPath?: string; depth: number };

  const { stackItems, orderedGroups } = useMemo(() => {
    // Build groups based on mode
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

    // Reorder: active terminal's group first
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

    // Build stack items with depth
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
  const stackTop = 82 + Math.min(maxDepth, CSS_MAX_DEPTH) * 24;

  // Focus active terminal
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

  // Keyboard shortcuts
  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

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

  if (allPtyIds.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-sm">No active sessions</div>
    );
  }

  const handleClose = (ptyId: string) => {
    const instance = terminalInstances.get(ptyId);
    if (instance) instance.dispose();
    useTerminalStore.getState().removeTerminal(ptyId);
  };

  return (
    <div className="project-stack" style={{ top: `${stackTop}px` }}>
      {/* Active terminal */}
      {activePtyId && (
        <div className="project-card project-card--active">
          <TerminalHeader ptyId={activePtyId} isActive={true} onClose={() => handleClose(activePtyId)} />
          <div className="project-card-body">
            <XTermContainer ptyId={activePtyId} />
          </div>
        </div>
      )}

      {/* Stacked terminals + dividers */}
      {stackItems.map((item) => {
        if (item.type === 'terminal') {
          const depthClass = item.depth <= CSS_MAX_DEPTH ? `project-card--back-${item.depth}` : 'project-card--hidden';
          return (
            <div
              key={item.ptyId}
              className={`project-card ${depthClass}`}
              onClick={() => setHomeActiveIndex(item.globalIndex)}
            >
              <TerminalHeader ptyId={item.ptyId} isActive={false} onClose={() => handleClose(item.ptyId)} />
              <div className="project-card-body">
                <XTermContainer ptyId={item.ptyId} />
              </div>
            </div>
          );
        }

        const depthClass = item.depth <= CSS_MAX_DEPTH ? `project-card--back-${item.depth}` : 'project-card--hidden';
        const project = item.projectPath ? projects.get(item.projectPath) : undefined;
        const dividerLabel = item.icon === 'project' ? project?.name || 'shell' : item.label;
        return (
          <HomeDivider
            key={`divider-${item.label}`}
            label={dividerLabel}
            icon={item.icon}
            project={item.icon === 'project' ? project : undefined}
            className={depthClass}
            onClick={() => {
              const group = orderedGroups.find((g) => g.label === item.label || g.projectPath === item.projectPath);
              if (group && group.ptyIds.length > 0) {
                setHomeActiveIndex(allPtyIds.indexOf(group.ptyIds[0]));
              }
            }}
          />
        );
      })}
    </div>
  );
}

// ── Divider (project or tag) ─────────────────────────────────────────

const DIVIDER_TAB_SVG = `<svg viewBox="0 0 234 28" width="234" height="28"><path d="M 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5 L 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 Z" fill="#252528"/><path d="M 0.5 27.5 L 0.5 14 Q 0.5 0.5 14 0.5 H 205.5 Q 219.5 0.5 219.5 14.5 L 219.5 13.5 Q 219.5 27.5 233.5 27.5" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/></svg>`;

function HomeDivider({
  label,
  icon,
  project,
  className,
  onClick,
}: {
  label: string;
  icon: 'project' | 'tag';
  project?: Project;
  className: string;
  onClick: () => void;
}) {
  return (
    <div className={`project-card home-folder-divider ${className}`} onClick={onClick}>
      <div className="home-folder-tab">
        <span dangerouslySetInnerHTML={{ __html: DIVIDER_TAB_SVG }} />
        <div className="home-folder-tab-content">
          {icon === 'project' ? (
            project?.iconDataUrl ? (
              <img className="home-folder-icon" src={project.iconDataUrl} alt={label} draggable={false} />
            ) : (
              <span
                className="home-folder-icon home-folder-icon-placeholder"
                style={{ backgroundColor: stringToColor(label) }}
              >
                {getInitials(label)}
              </span>
            )
          ) : (
            <Icon name="tag" className="home-tag-icon" />
          )}
          <span className="home-folder-name">{label}</span>
        </div>
      </div>
    </div>
  );
}
