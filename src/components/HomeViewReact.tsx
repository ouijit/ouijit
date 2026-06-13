import { useEffect, useState, useMemo, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { terminalInstances } from './terminal/terminalReact';
import { reconnectTerminal, addProjectTerminal, closeProjectTerminal } from './terminal/terminalActions';
import { TerminalHeader } from './terminal/TerminalHeader';
import { TerminalBody } from './terminal/TerminalBody';
import { XTermContainer } from './terminal/XTermContainer';
import { useTerminalPanels } from './terminal/useTerminalPanels';
import { useHookStatusListener } from '../hooks/useHookStatusListener';
import { Icon } from './terminal/Icon';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { passThroughSystemShortcut } from '../utils/keyboard';
import { RecentTasksPanel } from './RecentTasksPanel';
import { ResumeBanner } from './ResumeBanner';
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
  const allProjects = useAppStore((s) => s.projects);
  const projectCount = allProjects.length;
  const homeRecents = useAppStore((s) => s.homeRecents);
  const terminalsByProject = useTerminalStore((s) => s.terminalsByProject);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);

  const allPtyIds = useMemo(() => {
    const ids: string[] = [];
    for (const ptyIds of Object.values(terminalsByProject)) {
      for (const id of ptyIds) {
        if (!displayStates[id]?.isLoading) ids.push(id);
      }
    }
    return ids;
  }, [terminalsByProject, displayStates]);

  const [activePtyId, setActivePtyId] = useState<string | null>(null);
  const reconnectedRef = useRef(false);

  // Stack order: bigger tick = closer to the front. A terminal gets a tick
  // when it first appears and a fresh one each time it becomes the active
  // card, so the back stack stays in most-recently-front order — adding or
  // closing the front card only shifts its neighbors by one depth.
  const stackTickRef = useRef(0);
  const stackRecencyRef = useRef(new Map<string, number>());

  useEffect(() => {
    if (!activePtyId) return;
    stackRecencyRef.current.set(activePtyId, ++stackTickRef.current);
  }, [activePtyId]);

  useHookStatusListener(null);

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
        const [hookStatus, planPath] = await Promise.all([
          window.api.agentHooks.getStatus(session.ptyId),
          window.api.plan.getForPty(session.ptyId),
        ]);
        const initialStatus = hookStatus?.status === 'thinking' ? ('thinking' as const) : ('ready' as const);
        const term = await reconnectTerminal(session, { worktreeBranch, initialStatus });
        if (term && planPath) {
          term.planPath = planPath;
          term.pushDisplayState({ planPath });
        }
      }
    })();
  }, [allPtyIds.length]);

  const activeDisplay = activePtyId ? displayStates[activePtyId] : null;

  type StackItem =
    | { type: 'terminal'; ptyId: string; depth: number }
    | { type: 'divider'; key: string; label: string; icon: 'project' | 'tag'; projectPath?: string; depth: number };

  const { stackItems, orderedGroups } = useMemo(() => {
    type Group = { key: string; label: string; icon: 'project' | 'tag'; projectPath?: string; ptyIds: string[] };
    const groups: Group[] = [];
    const seen = new Map<string, number>();

    // Assign appearance ticks so a freshly spawned terminal sorts to the
    // front of the back stack even before its activation tick lands
    const recency = stackRecencyRef.current;
    for (const ptyId of allPtyIds) {
      if (!recency.has(ptyId)) recency.set(ptyId, ++stackTickRef.current);
    }
    const rank = (ptyId: string) => recency.get(ptyId) ?? 0;

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

    for (const group of groups) {
      group.ptyIds.sort((a, b) => rank(b) - rank(a));
    }

    const groupRank = (group: Group) => Math.max(...group.ptyIds.map(rank));
    const rest = groups.filter((g) => g.key !== activeGroupKey).sort((a, b) => groupRank(b) - groupRank(a));
    const ordered = activeGroupKey ? [...groups.filter((g) => g.key === activeGroupKey), ...rest] : rest;

    const items: StackItem[] = [];
    let depth = 0;
    for (const group of ordered) {
      for (const ptyId of group.ptyIds) {
        if (ptyId === activePtyId) continue;
        depth++;
        items.push({ type: 'terminal', ptyId, depth });
      }
      depth++;
      items.push({
        type: 'divider',
        key: group.key,
        label: group.label,
        icon: group.icon,
        projectPath: group.projectPath,
        depth,
      });
    }

    return { stackItems: items, orderedGroups: ordered };
  }, [allPtyIds, displayStates, homeGroupMode, activeDisplay, activePtyId]);

  // Keep activePtyId valid: if the active terminal was removed, fall back to
  // the front-most card of the back stack (visual order, not insertion order)
  useEffect(() => {
    if (allPtyIds.length === 0) {
      if (activePtyId !== null) setActivePtyId(null);
      return;
    }
    if (activePtyId === null || !allPtyIds.includes(activePtyId)) {
      const next = stackItems.find((i): i is Extract<StackItem, { type: 'terminal' }> => i.type === 'terminal');
      setActivePtyId(next ? next.ptyId : allPtyIds[allPtyIds.length - 1]);
    }
  }, [allPtyIds, activePtyId, stackItems]);

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

      // Let Electron's native accelerators (reload, quit) through to the OS
      // instead of the focused terminal. Shared with the project view.
      if (passThroughSystemShortcut(e)) return;

      const key = e.key.toLowerCase();

      // Cmd+I — new terminal, brought to the front of the stack
      if (key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        window.api.homePath().then(async (homePath) => {
          const added = await addProjectTerminal(homePath);
          if (!added) return;
          const ptyIds = useTerminalStore.getState().terminalsByProject[homePath];
          if (ptyIds && ptyIds.length > 0) setActivePtyId(ptyIds[ptyIds.length - 1]);
        });
        return;
      }

      // Cmd+T — toggle grouping mode
      if (key === 't') {
        e.preventDefault();
        e.stopPropagation();
        const current = useUIStore.getState().homeGroupMode;
        useUIStore.getState().setHomeGroupMode(current === 'project' ? 'tag' : 'project');
        return;
      }

      if (key === 'w' && activePtyId) {
        e.preventDefault();
        e.stopPropagation();
        // Promote the next card in visual stack order before closing so
        // repeated Cmd+W peels cards front-to-back
        const next = stackItems.find((i): i is Extract<StackItem, { type: 'terminal' }> => i.type === 'terminal');
        if (next) setActivePtyId(next.ptyId);
        closeProjectTerminal(activePtyId);
        return;
      }

      const num = parseInt(key, 10);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        e.stopPropagation();
        const termItems = stackItems.filter(
          (i): i is Extract<StackItem, { type: 'terminal' }> => i.type === 'terminal',
        );
        const reversed = [...termItems].reverse();
        if (num <= reversed.length) {
          setActivePtyId(reversed[num - 1].ptyId);
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

  // Dividers extracted from stackItems — sorted by key for stable DOM order so CSS transitions fire
  const dividers = useMemo(
    () =>
      (
        stackItems.filter((i) => i.type === 'divider') as Array<
          Extract<(typeof stackItems)[number], { type: 'divider' }>
        >
      ).sort((a, b) => a.key.localeCompare(b.key)),
    [stackItems],
  );

  const handleClose = (ptyId: string) => {
    if (ptyId === activePtyId) {
      const next = stackItems.find((i): i is Extract<StackItem, { type: 'terminal' }> => i.type === 'terminal');
      if (next) setActivePtyId(next.ptyId);
    }
    closeProjectTerminal(ptyId);
  };

  const {
    toggleDiffPanel,
    closeDiffPanel,
    toggleRunner,
    collapseRunner,
    killRunner,
    restartRunner,
    closePlanPanel,
    changePlanFile,
    closeWebPreviewPanel,
    changeWebPreviewUrl,
  } = useTerminalPanels(activePtyId);

  if (allPtyIds.length === 0) {
    const noProjects = projectCount === 0;
    const noRecents = !noProjects && homeRecents !== null && homeRecents.length === 0;
    const isMac = navigator.platform.toLowerCase().includes('mac');

    return (
      <div
        className="fixed top-[82px] right-4 bottom-4 z-[100] overflow-visible"
        style={{
          left: 'calc(var(--sidebar-offset, 0px) + 16px)',
          transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
        }}
      >
        {noProjects ? (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
            <div className="w-full max-w-[36rem]">
              <div
                className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden"
                style={{
                  background: 'var(--color-terminal-bg)',
                  boxShadow:
                    '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
                }}
              >
                <div className="px-5 py-3">
                  <span className="text-sm text-text-primary leading-tight">Start a project</span>
                </div>
                <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
                  <EmptyStateChoice
                    verb="Open"
                    noun="a folder you already have"
                    detail="Brings an existing folder into Ouijit as a project."
                    onClick={() => document.dispatchEvent(new Event('add-existing-project'))}
                  />
                  <EmptyStateChoice
                    verb="Create"
                    noun="a new project"
                    detail="Creates a new folder, initialized as a git repo."
                    onClick={() => document.dispatchEvent(new Event('create-new-project'))}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : noRecents ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary rounded-[14px] border border-dashed border-white/10"
            style={{ background: 'var(--color-terminal-bg)' }}
          >
            <div className="text-sm">No tasks yet.</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-[13px]">{isMac ? '⌘ I' : '⌃ I'}</span>
              <span>to open a terminal</span>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
            <div className="w-full max-w-[36rem] flex flex-col gap-3 max-h-full min-h-0">
              <ResumeBanner />
              <RecentTasksPanel projects={allProjects} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="project-stack fixed top-[82px] right-4 bottom-4 z-[100] overflow-visible"
      style={{
        top: `${stackTop}px`,
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
      }}
    >
      {/* All terminals — stable keys, depth changes animate via transition */}
      {allPtyIds.map((ptyId) => {
        const depth = depthMap.get(ptyId) ?? 0;
        const isActive = ptyId === activePtyId;
        return (
          <div
            key={ptyId}
            className={`glass-bevel absolute inset-0 rounded-[14px] border border-black/60 overflow-hidden flex flex-col${!isActive ? ' hover:border-accent' : ''}`}
            style={{
              ...getDepthStyle(depth),
              background: 'var(--color-terminal-bg, #171717)',
              ...(isActive
                ? {
                    boxShadow:
                      '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
                  }
                : {}),
            }}
            onClick={() => !isActive && setActivePtyId(ptyId)}
          >
            <TerminalHeader
              ptyId={ptyId}
              isActive={isActive}
              compact={!isActive}
              onClose={() => handleClose(ptyId)}
              onToggleDiffPanel={isActive ? toggleDiffPanel : undefined}
              onToggleRunner={isActive ? toggleRunner : undefined}
            />
            {isActive ? (
              <TerminalBody
                ptyId={ptyId}
                projectPath={activeDisplay?.projectPath ?? ''}
                onCloseDiffPanel={closeDiffPanel}
                onClosePlanPanel={closePlanPanel}
                onChangePlanFile={changePlanFile}
                onCloseWebPreviewPanel={closeWebPreviewPanel}
                onChangeWebPreviewUrl={changeWebPreviewUrl}
                onCollapseRunner={collapseRunner}
                onKillRunner={killRunner}
                onRestartRunner={restartRunner}
              />
            ) : (
              <div className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
                <XTermContainer ptyId={ptyId} />
              </div>
            )}
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
            key={`divider-${item.key}`}
            className="absolute inset-0 rounded-[14px] overflow-visible flex flex-col"
            style={{
              ...getDepthStyle(item.depth),
              background: 'transparent',
              borderColor: 'transparent',
              boxShadow: 'none',
              contain: 'unset',
              pointerEvents: 'none',
              marginTop: -1,
            }}
          >
            {/* Card body below the tab — square TL so tab sits flush */}
            <div
              className="absolute border border-black/60"
              style={{
                top: 27,
                left: 0,
                right: 0,
                bottom: 0,
                background: '#252528',
                borderRadius: '0 14px 14px 14px',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.14), inset -1px 0 0 rgba(255,255,255,0.05), inset 1px 0 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.5)',
              }}
            />
            <div
              className="home-folder-tab absolute top-0 left-0 pointer-events-auto border border-black/60"
              style={{
                width: 220,
                height: 28,
                background: '#252528',
                borderBottom: 'none',
                borderRadius: '12px 12px 0 0',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.14), inset 1px 0 0 rgba(255,255,255,0.05), inset -1px 0 0 rgba(255,255,255,0.05), inset 0 2px 6px -3px rgba(255,255,255,0.08)',
                transform: `scale(${Math.max(0.92, 1 - item.depth * 0.015)})`,
                transformOrigin: 'bottom left',
                transition: 'transform 200ms ease-out',
              }}
              onClick={() => {
                const group = orderedGroups.find((g) => g.key === item.key);
                if (group && group.ptyIds.length > 0) {
                  setActivePtyId(group.ptyIds[0]);
                }
              }}
            >
              <div className="absolute inset-0 flex items-center" style={{ gap: 6, padding: '0 12px 0 8px' }}>
                {item.icon === 'tag' ? (
                  <span
                    className="shrink-0 object-cover flex items-center justify-center"
                    style={{ width: 16, minWidth: 16, height: 16, borderRadius: 4, aspectRatio: '1' }}
                  >
                    <Icon name="tag" />
                  </span>
                ) : isRegisteredProject ? (
                  project?.iconDataUrl ? (
                    <img
                      className="shrink-0 object-cover"
                      style={{ width: 16, minWidth: 16, height: 16, aspectRatio: '1' }}
                      src={project.iconDataUrl}
                      alt={name}
                      draggable={false}
                    />
                  ) : (
                    <span
                      className="shrink-0 object-cover flex items-center justify-center text-white"
                      style={{
                        width: 16,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 4,
                        aspectRatio: '1',
                        backgroundColor: stringToColor(name),
                        fontSize: 7,
                        fontWeight: 700,
                        textShadow: '0 1px 1px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {getInitials(name)}
                    </span>
                  )
                ) : (
                  <span
                    className="shrink-0 object-cover flex items-center justify-center"
                    style={{ width: 16, minWidth: 16, height: 16, borderRadius: 4, aspectRatio: '1' }}
                  >
                    <Icon name="terminal" />
                  </span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: 'rgba(255, 255, 255, 0.45)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {name}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface EmptyStateChoiceProps {
  verb: string;
  noun: string;
  detail: string;
  onClick: () => void;
}

function EmptyStateChoice({ verb, noun, detail, onClick }: EmptyStateChoiceProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-baseline gap-3 w-full text-left px-5 py-3 hover:bg-white/[0.04] transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-light outline-none [-webkit-app-region:no-drag]"
    >
      <span className="text-[15px] text-text-tertiary group-hover:text-text-primary transition-colors w-3 shrink-0">
        →
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-[14px] text-text-primary">
          <span className="font-semibold">{verb}</span> <span className="text-text-secondary">{noun}.</span>
        </span>
        <span className="block text-[12px] text-text-tertiary mt-0.5 leading-relaxed">{detail}</span>
      </span>
    </button>
  );
}
