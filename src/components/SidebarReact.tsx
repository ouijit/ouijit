import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Project } from '../types';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { projectIconColor } from '../utils/projectIcon';
import { CloningProjectIcon } from './CloningProjectIcon';
import { SidebarTooltipWrapper, SidebarTile } from './SidebarTooltip';
const isMac = navigator.platform.toLowerCase().includes('mac');

interface SidebarProps {
  onProjectSelect: (path: string, project: Project) => void;
  onHomeSelect: () => void;
  onAddProject: () => void;
  onCloneSelect: (projectPath: string) => void;
}

export function Sidebar({ onProjectSelect, onHomeSelect, onAddProject, onCloneSelect }: SidebarProps) {
  const projects = useAppStore((s) => s.projects);
  const cloningPaths = useAppStore(useShallow((s) => s.cloneJobs.map((job) => job.projectPath)));
  const activeView = useAppStore((s) => s.activeView);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const fullscreen = useAppStore((s) => s.fullscreen);
  const sidebarPinned = useUIStore((s) => s.sidebarPinned);

  const sidebarRef = useRef<HTMLElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noProjects = projects.length === 0;
  const [visible, setVisible] = useState(false);
  const effectiveVisible = visible || sidebarPinned;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null);

  // Ordered project paths for @dnd-kit
  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);
  useEffect(() => {
    setOrderedPaths(projects.map((p) => p.path));
  }, [projects]);

  const projectMap = new Map(projects.map((p) => [p.path, p]));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedPaths.indexOf(active.id as string);
      const newIndex = orderedPaths.indexOf(over.id as string);
      const newOrder = arrayMove(orderedPaths, oldIndex, newIndex);
      setOrderedPaths(newOrder);
      window.api.reorderProjects(newOrder);
    },
    [orderedPaths],
  );

  const showSidebar = useCallback(() => {
    if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    showTimeoutRef.current = null;
    hideTimeoutRef.current = null;
    setVisible(true);

    document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
  }, []);

  const hideSidebar = useCallback(() => {
    if (sidebarPinned) return;
    // Keep the sidebar pinned open until the user has at least one project —
    // otherwise the only entry point for "add project" disappears on hover-out.
    if (noProjects) return;
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);

      document.documentElement.style.setProperty('--sidebar-offset', '0px');
    }, 300);
  }, [noProjects, sidebarPinned]);

  useEffect(() => {
    const handler = () => showSidebar();
    document.addEventListener('show-sidebar', handler);
    return () => document.removeEventListener('show-sidebar', handler);
  }, [showSidebar]);

  // Listen for toggle-sidebar events from the titlebar project icon. Toggling
  // drives the pinned state so the choice persists; when unpinning we collapse
  // immediately since the cursor isn't over the sidebar to trigger mouse-leave.
  useEffect(() => {
    const handler = () => {
      const ui = useUIStore.getState();
      if (ui.sidebarPinned) {
        ui.setSidebarPinned(false);
        if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        showTimeoutRef.current = null;
        hideTimeoutRef.current = null;
        setVisible(false);
        document.documentElement.style.setProperty('--sidebar-offset', '0px');
      } else {
        ui.setSidebarPinned(true);
      }
    };
    document.addEventListener('toggle-sidebar', handler);
    return () => document.removeEventListener('toggle-sidebar', handler);
  }, []);

  // Pin the sidebar open whenever there are no projects so the add-project
  // button stays visible (otherwise it auto-hides on mouse-out).
  useEffect(() => {
    if (noProjects) showSidebar();
  }, [noProjects, showSidebar]);

  // When the user-toggled pin flips on, lock the sidebar visible and reserve
  // its width in the layout. No inverse on flip-off: hideSidebar is the only
  // path that retracts the sidebar, and its `if (sidebarPinned) return` guard
  // (re-evaluated when sidebarPinned drops) lets the next mouse-leave hide it
  // and reset --sidebar-offset to 0px. Driving an inverse from this effect
  // would race with hover state.
  useEffect(() => {
    if (sidebarPinned) {
      setVisible(true);
      document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
    }
  }, [sidebarPinned]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: MouseEvent) => {
      const menu = document.querySelector('.sidebar-context-menu-react');
      if (menu?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', dismiss);
    };
  }, [contextMenu]);

  const handleRemoveProject = useCallback(async (project: Project) => {
    setContextMenu(null);
    const result = await window.api.removeProject(project.path);
    if (result.success) {
      const refreshed = await window.api.refreshProjects();
      useAppStore.getState().setProjects(refreshed);
    }
  }, []);

  return (
    <>
      {/* Trigger zone — hidden when sidebar is visible */}
      {!effectiveVisible && (
        <div
          className="fixed top-0 bottom-0 left-0 z-[10000]"
          style={{ width: 24 }}
          onMouseEnter={(e) => {
            if (e.buttons !== 0) return;
            showTimeoutRef.current = setTimeout(showSidebar, 120);
          }}
          onMouseLeave={() => {
            if (showTimeoutRef.current) {
              clearTimeout(showTimeoutRef.current);
              showTimeoutRef.current = null;
            }
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className="fixed bottom-0 left-0 z-[10001] flex flex-col overflow-hidden"
        style={{
          top: isMac && !fullscreen ? 0 : 60,
          width: effectiveVisible ? 'var(--sidebar-width)' : 0,
          transition: 'width 200ms ease-out',
          background: 'var(--color-background)',
        }}
        onMouseEnter={showSidebar}
        onMouseLeave={hideSidebar}
      >
        {/* Top spacer — sized so the home button's logomark aligns with the
            content area top (top:82px) on the right of the window. */}
        <div className="shrink-0 [-webkit-app-region:drag]" style={{ height: isMac && !fullscreen ? 78 : 18 }} />

        {/* Home button */}
        <SidebarTooltipWrapper label="Home">
          {(tipRef, tipProps) => (
            <div
              ref={tipRef}
              {...tipProps}
              className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag] self-center"
              style={{ width: 'var(--sidebar-width)', height: 48 }}
              onClick={onHomeSelect}
            >
              <div
                className={`absolute left-0 w-1 rounded-r-sm bg-ink transition-all duration-200 ease-out ${
                  activeView === 'home' ? 'h-9 opacity-100' : 'h-0 opacity-0 group-hover:h-5 group-hover:opacity-50'
                }`}
              />
              <div className="w-10 h-10 overflow-hidden rounded-md bg-transparent">
                <div
                  className="sidebar-home-logo-mask w-full h-full"
                  style={{
                    backgroundColor: activeView === 'home' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    transition: 'background-color 150ms ease-out',
                  }}
                />
              </div>
            </div>
          )}
        </SidebarTooltipWrapper>

        <div
          className="mx-auto mb-1 mt-2 shrink-0"
          style={{ width: 32, height: 1, background: 'var(--color-border)' }}
        />

        {/* Project list with drag-to-reorder */}
        <div className="flex-1 flex flex-col items-center gap-2 py-2 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedPaths} strategy={verticalListSortingStrategy}>
              {orderedPaths.map((path) => {
                const project = projectMap.get(path);
                if (!project) return null;
                return (
                  <SortableProjectIcon
                    key={path}
                    project={project}
                    isActive={activeView === 'project' && activeProjectPath === path}
                    onClick={() => onProjectSelect(path, project)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, project });
                    }}
                  />
                );
              })}
            </SortableContext>
          </DndContext>

          {cloningPaths.map((projectPath) => (
            <CloningProjectIcon
              key={projectPath}
              projectPath={projectPath}
              isActive={activeView === 'project' && activeProjectPath === projectPath}
              onClick={() => onCloneSelect(projectPath)}
            />
          ))}

          {/* Add button */}
          <SidebarTooltipWrapper label="Add project">
            {(tipRef, tipProps) => (
              <div
                ref={tipRef}
                {...tipProps}
                className="flex items-center justify-center shrink-0 mt-2"
                style={{ width: 'var(--sidebar-width)', height: 40 }}
              >
                <button
                  className="w-10 h-10 flex items-center justify-center relative glass-bevel overflow-hidden rounded-[12px] bg-background-secondary border border-bezel text-text-secondary transition-colors duration-200 ease-out [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddProject();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
                  </svg>
                </button>
              </div>
            )}
          </SidebarTooltipWrapper>
        </div>
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="sidebar-context-menu-react fixed z-[10002] p-1 glass-bevel border border-bezel rounded-[12px] overflow-hidden opacity-100"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 120),
            top: Math.min(contextMenu.y, window.innerHeight - 40),
            background: 'var(--color-terminal-bg)',
            boxShadow: 'var(--shadow-menu)',
          }}
        >
          <button
            className="w-full px-2.5 py-1.5 rounded-[7px] text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out hover:bg-error/10 hover:text-error"
            onClick={() => handleRemoveProject(contextMenu.project)}
          >
            Remove
          </button>
        </div>
      )}
    </>
  );
}

// ── Sortable project icon ────────────────────────────────────────────

interface SortableProjectIconProps {
  project: Project;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableProjectIcon({ project, isActive, onClick, onContextMenu }: SortableProjectIconProps) {
  const terminalCount = useTerminalStore(
    (s) => (s.terminalsByProject[project.path] ?? []).filter((id) => !s.displayStates[id]?.isLoading).length,
  );
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project.path,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <SidebarTooltipWrapper label={project.name} disabled={isDragging}>
      {(tipRef, tipProps) => (
        <div
          ref={(node) => {
            setNodeRef(node);
            tipRef(node);
          }}
          {...attributes}
          {...tipProps}
          {...listeners}
          className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag]"
          style={{ ...style, width: 'var(--sidebar-width)', height: 48 }}
          data-project-path={project.path}
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          <SidebarTile name={project.name} color={projectIconColor(project)} isActive={isActive}>
            {terminalCount > 0 && (
              <span
                className="absolute bottom-0 right-2 flex items-center justify-center text-accent-ink font-bold"
                style={{
                  minWidth: 16,
                  height: 16,
                  fontSize: 10,
                  lineHeight: 1,
                  padding: '0 4px',
                  borderRadius: 8,
                  background: 'var(--color-accent)',
                  border: '2px solid var(--color-background)',
                }}
              >
                {terminalCount}
              </span>
            )}
          </SidebarTile>
        </div>
      )}
    </SidebarTooltipWrapper>
  );
}
