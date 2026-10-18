import { useEffect, useMemo } from 'react';
import { ProjectSourceList, openAddProject } from './projectSources';
import { useAppStore } from '../stores/appStore';
import {
  HOME_STACK,
  activateTerminal,
  useTagFilter,
  useTerminalStore,
  useVisibleStack,
  visibleStack,
  type TerminalDisplayState,
} from '../stores/terminalStore';
import { useUIStore, type HomeGroupMode } from '../stores/uiStore';
import { reconnectOrphanedSessions } from './terminal/terminalActions';
import { TerminalCard } from './terminal/TerminalCard';
import { FilteredEmptyState } from './terminal/TerminalCardStack';
import { setStackPositions } from './terminal/stackPositions';
import { useTerminalView, useViewKeys } from './terminal/terminalShortcuts';
import { Icon } from './terminal/Icon';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { RecentTasksPanel } from './RecentTasksPanel';
import { ResumeBanner } from './ResumeBanner';

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

type Divider = {
  key: string;
  label: string;
  kind: 'project' | 'tag';
  projectPath?: string;
  depth: number;
  first: string;
};

interface HomeLayout {
  cards: { ptyId: string; depth: number }[];
  dividers: Divider[];
  depth: number;
}

function groupOf(display: TerminalDisplayState, mode: HomeGroupMode): Omit<Divider, 'depth' | 'first'> {
  if (mode === 'tag') {
    const tag = display.tags[0] ?? null;
    return { key: tag ? `tag:${tag.toLowerCase()}` : 'tag:__untagged__', label: tag ?? 'Untagged', kind: 'tag' };
  }
  return {
    key: `project:${display.projectPath}`,
    label: display.projectPath,
    kind: 'project',
    projectPath: display.projectPath,
  };
}

/**
 * The stack under dividers. A group sits where its most recent terminal does,
 * so the active terminal's group comes first, and its divider lies behind its
 * last card.
 */
function layOut(
  ordered: string[],
  displayStates: Record<string, TerminalDisplayState>,
  mode: HomeGroupMode,
): HomeLayout {
  const groups = new Map<string, { group: Omit<Divider, 'depth' | 'first'>; ptyIds: string[] }>();
  for (const ptyId of ordered) {
    const display = displayStates[ptyId];
    if (!display) continue;
    const group = groupOf(display, mode);
    const entry = groups.get(group.key) ?? groups.set(group.key, { group, ptyIds: [] }).get(group.key)!;
    entry.ptyIds.push(ptyId);
  }
  const cards: HomeLayout['cards'] = [];
  const dividers: Divider[] = [];
  let depth = 0;
  for (const { group, ptyIds } of groups.values()) {
    for (const ptyId of ptyIds) cards.push({ ptyId, depth: depth++ });
    dividers.push({ ...group, depth: depth++, first: ptyIds[0] });
  }
  return { cards, dividers, depth: Math.max(depth - 1, 0) };
}

export function HomeView() {
  const allProjects = useAppStore((s) => s.projects);
  const projectCount = allProjects.length;
  const homeRecents = useAppStore((s) => s.homeRecents);
  const memberCount = useTerminalStore((s) => s.order.length);
  const visible = useVisibleStack(HOME_STACK);
  const tagFilter = useTagFilter(HOME_STACK);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);

  useTerminalView({
    stack: HOME_STACK,
    shellPath: () => window.api.homePath(),
    onScreen: () => visibleStack(useTerminalStore.getState(), HOME_STACK),
  });

  useViewKeys({
    t: () => useUIStore.getState().setHomeGroupMode(homeGroupMode === 'project' ? 'tag' : 'project'),
  });

  // After a renderer reload only the projects visited since are reattached,
  // and the home stack holds every project's terminals.
  useEffect(() => {
    void reconnectOrphanedSessions();
  }, []);

  const layout = useMemo(() => layOut(visible, displayStates, homeGroupMode), [visible, displayStates, homeGroupMode]);
  const backCards = layout.cards.slice(1);

  useEffect(() => {
    setStackPositions(backCards.map((c) => c.ptyId).reverse());
    return () => setStackPositions([]);
  });

  if (memberCount === 0) {
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
              <ProjectSourceList title="Start a project" onChoose={openAddProject} />
            </div>
          </div>
        ) : noRecents ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary rounded-[14px] border border-dashed border-ink/10"
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

  const projectsByPath = new Map(allProjects.map((p) => [p.path, p]));

  return (
    <div
      className="project-stack fixed top-[82px] right-4 bottom-4 z-[100] overflow-visible"
      style={{
        top: `${82 + layout.depth * 24}px`,
        left: 'calc(var(--sidebar-offset, 0px) + 16px)',
        transition: 'left 0.2s ease-out, right 0.25s ease, top 0.2s ease',
      }}
    >
      {visible.length === 0 && tagFilter && (
        <FilteredEmptyState
          tag={tagFilter}
          onClear={() => useTerminalStore.getState().setTagFilter(HOME_STACK, null)}
        />
      )}

      {layout.cards.map(({ ptyId, depth }) => (
        <TerminalCard
          key={ptyId}
          ptyId={ptyId}
          depth={depth}
          stackPosition={depth === 0 ? undefined : backCards.length - backCards.findIndex((c) => c.ptyId === ptyId)}
        />
      ))}

      {[...layout.dividers]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((item) => {
          const project = item.projectPath ? projectsByPath.get(item.projectPath) : undefined;
          const isRegisteredProject = item.kind === 'project' && project != null;
          const name = item.kind === 'project' ? project?.name || 'Shell' : item.label;

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
                className="absolute border border-bezel"
                style={{
                  top: 27,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'var(--color-surface-raised)',
                  borderRadius: '0 14px 14px 14px',
                  boxShadow:
                    'inset 0 1px 0 var(--bevel-top), inset -1px 0 0 var(--bevel-side), inset 1px 0 0 var(--bevel-side), inset 0 -1px 0 var(--bevel-bottom)',
                }}
              />
              <div
                className="home-folder-tab absolute top-0 left-0 pointer-events-auto border border-bezel"
                style={{
                  width: 220,
                  height: 28,
                  background: 'var(--color-surface-raised)',
                  borderBottom: 'none',
                  borderRadius: '12px 12px 0 0',
                  boxShadow:
                    'inset 0 1px 0 var(--bevel-top), inset 1px 0 0 var(--bevel-side), inset -1px 0 0 var(--bevel-side), var(--bevel-cast)',
                  transform: `scale(${Math.max(0.92, 1 - item.depth * 0.015)})`,
                  transformOrigin: 'bottom left',
                  transition: 'transform 200ms ease-out',
                }}
                onClick={() => activateTerminal(item.first)}
              >
                <div className="absolute inset-0 flex items-center" style={{ gap: 6, padding: '0 12px 0 8px' }}>
                  {item.kind === 'tag' ? (
                    <span
                      className="shrink-0 object-cover flex items-center justify-center"
                      style={{ width: 16, minWidth: 16, height: 16, borderRadius: 4, aspectRatio: '1' }}
                    >
                      <Icon name="tag" />
                    </span>
                  ) : isRegisteredProject ? (
                    <span
                      className="shrink-0 object-cover flex items-center justify-center text-white"
                      style={{
                        width: 16,
                        minWidth: 16,
                        height: 16,
                        borderRadius: 4,
                        aspectRatio: '1',
                        backgroundColor: project?.iconColor ?? stringToColor(name),
                        fontSize: 7,
                        fontWeight: 700,
                        textShadow: '0 1px 1px rgba(0, 0, 0, 0.2)',
                      }}
                    >
                      {getInitials(name)}
                    </span>
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
                      color: 'color-mix(in srgb, var(--color-ink) 45%, transparent)',
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
