import { useCallback, useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useFloating,
  useHover,
  useDismiss,
  useRole,
  useInteractions,
  autoUpdate,
  offset,
  flip,
  shift,
} from '@floating-ui/react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import { useAppStore } from '../stores/appStore';
import { useTerminalStore } from '../stores/terminalStore';
import { useUIStore } from '../stores/uiStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
const isMac = navigator.platform.toLowerCase().includes('mac');

interface SidebarProps {
  onProjectSelect: (path: string, project: Project) => void;
  onHomeSelect: () => void;
  onAddExisting: () => void;
  onCreateNew: () => void;
}

export function Sidebar({ onProjectSelect, onHomeSelect, onAddExisting, onCreateNew }: SidebarProps) {
  const projects = useAppStore((s) => s.projects);
  const activeView = useAppStore((s) => s.activeView);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const fullscreen = useAppStore((s) => s.fullscreen);
  const sidebarPinned = useUIStore((s) => s.sidebarPinned);

  const sidebarRef = useRef<HTMLElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noProjects = projects.length === 0;
  // Start visible on every app open so the sidebar is always discoverable;
  // the existing hideSidebar path (mouse-leave) collapses it from there.
  const [visible, setVisible] = useState(true);
  const effectiveVisible = visible || sidebarPinned;

  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null);

  // Ordered project paths for @dnd-kit
  const [orderedPaths, setOrderedPaths] = useState<string[]>([]);
  useEffect(() => {
    setOrderedPaths(projects.map((p) => p.path));
  }, [projects]);

  const projectMap = new Map(projects.map((p) => [p.path, p]));

  // DnD sensors
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

  // Auto-hide sidebar
  const showSidebar = useCallback(() => {
    if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    showTimeoutRef.current = null;
    hideTimeoutRef.current = null;
    setVisible(true);

    document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
  }, []);

  const hideSidebar = useCallback(() => {
    if (addMenuOpen) return;
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
  }, [addMenuOpen, noProjects, sidebarPinned]);

  // Listen for show-sidebar events from the header toggle button
  useEffect(() => {
    const handler = () => showSidebar();
    document.addEventListener('show-sidebar', handler);
    return () => document.removeEventListener('show-sidebar', handler);
  }, [showSidebar]);

  // Sidebar starts visible (see initial useState above) — match the layout
  // offset to that on mount so content doesn't render under the sidebar
  // before the first show/hide tick.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
  }, []);

  // Listen for open-add-menu events from the home empty state CTA
  useEffect(() => {
    const handler = () => {
      showSidebar();
      setAddMenuOpen(true);
    };
    document.addEventListener('open-add-menu', handler);
    return () => document.removeEventListener('open-add-menu', handler);
  }, [showSidebar]);

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

  // Context menu dismiss
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

  // Add menu dismiss
  useEffect(() => {
    if (!addMenuOpen) return;
    const dismiss = (e: MouseEvent) => {
      const menu = document.querySelector('.sidebar-add-menu-react');
      if (menu?.contains(e.target as Node)) return;
      setAddMenuOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', dismiss);
    };
  }, [addMenuOpen]);

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
                className={`absolute left-0 w-1 rounded-r-sm bg-white transition-all duration-200 ease-out ${
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

          {/* Add button */}
          <SidebarTooltipWrapper label="Add project" disabled={addMenuOpen}>
            {(tipRef, tipProps) => (
              <div
                ref={tipRef}
                {...tipProps}
                className="flex items-center justify-center shrink-0 mt-2"
                style={{ width: 'var(--sidebar-width)', height: 40 }}
              >
                <button
                  ref={addBtnRef}
                  className="w-10 h-10 flex items-center justify-center rounded-md bg-background-secondary border border-border/50 text-text-secondary transition-colors duration-200 ease-out [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddMenuOpen(!addMenuOpen);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z" />
                  </svg>
                </button>
              </div>
            )}
          </SidebarTooltipWrapper>

          {/* Pin toggle — same active-state treatment as the home/project
              items (white left-bar indicator on hover/active). */}
          <SidebarTooltipWrapper label={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar open'}>
            {(tipRef, tipProps) => (
              <div
                ref={tipRef}
                {...tipProps}
                className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag]"
                style={{ width: 'var(--sidebar-width)', height: 40 }}
                onClick={() => useUIStore.getState().toggleSidebarPinned()}
                role="button"
                tabIndex={0}
                aria-pressed={sidebarPinned}
                aria-label={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
              >
                <div
                  className={`absolute left-0 w-1 rounded-r-sm bg-white transition-all duration-200 ease-out ${
                    sidebarPinned ? 'h-7 opacity-100' : 'h-0 opacity-0 group-hover:h-4 group-hover:opacity-50'
                  }`}
                />
                <Icon
                  name="sidebar-simple"
                  className={`w-5 h-5 transition-colors duration-150 ${
                    sidebarPinned ? 'text-text-primary' : 'text-text-tertiary group-hover:text-text-secondary'
                  }`}
                />
              </div>
            )}
          </SidebarTooltipWrapper>
        </div>
      </aside>

      {/* Add menu (portal-like, absolute positioned) */}
      {addMenuOpen && (
        <AddMenu
          anchorRef={addBtnRef}
          onAddExisting={onAddExisting}
          onCreateNew={onCreateNew}
          onClose={() => setAddMenuOpen(false)}
        />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="sidebar-context-menu-react fixed z-[10002] py-1 bg-surface border border-border rounded-md shadow-lg overflow-hidden opacity-100"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 120),
            top: Math.min(contextMenu.y, window.innerHeight - 40),
          }}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out hover:bg-background-tertiary hover:text-error"
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

  // Tooltip via floating-ui hooks (no wrapper element needed)
  const [tipOpen, setTipOpen] = useState(false);
  const {
    refs: tipRefs,
    floatingStyles: tipStyles,
    context: tipContext,
  } = useFloating({
    open: tipOpen,
    onOpenChange: setTipOpen,
    placement: 'right',
    strategy: 'fixed',
    middleware: [offset(-4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const tipHover = useHover(tipContext, { move: false, delay: { open: 100 } });
  const tipDismiss = useDismiss(tipContext);
  const tipRole = useRole(tipContext, { role: 'tooltip' });
  const { getReferenceProps: getTipRefProps, getFloatingProps: getTipFloatProps } = useInteractions([
    tipHover,
    tipDismiss,
    tipRole,
  ]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <>
      <div
        ref={(node) => {
          setNodeRef(node);
          tipRefs.setReference(node);
        }}
        {...attributes}
        {...getTipRefProps()}
        {...listeners}
        className="group relative flex items-center justify-center shrink-0 [-webkit-app-region:no-drag]"
        style={{ ...style, width: 'var(--sidebar-width)', height: 48 }}
        data-project-path={project.path}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <div
          className={`absolute left-0 w-1 rounded-r-sm bg-white transition-all duration-200 ease-out ${
            isActive ? 'h-9 opacity-100' : 'h-0 opacity-0 group-hover:h-5 group-hover:opacity-50'
          }`}
        />
        <div className="w-10 h-10 overflow-hidden rounded-md">
          {project.iconDataUrl ? (
            <img
              src={project.iconDataUrl}
              alt={project.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: stringToColor(project.name), textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
            >
              {getInitials(project.name)}
            </div>
          )}
        </div>
        {terminalCount > 0 && (
          <span
            className="absolute bottom-0 right-2 flex items-center justify-center text-white font-bold"
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
      </div>
      {tipOpen &&
        !isDragging &&
        createPortal(
          <div
            ref={tipRefs.setFloating}
            className="fixed z-[10002] pointer-events-none"
            style={tipStyles}
            {...getTipFloatProps()}
          >
            <div className="px-3 py-1.5 text-[13px] font-medium text-white bg-neutral-800 border border-white/10 rounded-md shadow-lg whitespace-nowrap animate-tooltip-pop">
              {project.name}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Sidebar tooltip wrapper ─────────────────────────────────────────

function SidebarTooltipWrapper({
  label,
  children,
  disabled,
}: {
  label: string;
  children: (ref: (node: HTMLElement | null) => void, props: Record<string, unknown>) => React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: open && !disabled,
    onOpenChange: setOpen,
    placement: 'right',
    strategy: 'fixed',
    middleware: [offset(-4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false, delay: { open: 100 } });
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss, role]);

  return (
    <>
      {children(refs.setReference as (node: HTMLElement | null) => void, getReferenceProps())}
      {open &&
        !disabled &&
        createPortal(
          <div
            ref={refs.setFloating}
            className="fixed z-[10002] pointer-events-none"
            style={floatingStyles}
            {...getFloatingProps()}
          >
            <div className="px-3 py-1.5 text-[13px] font-medium text-white bg-neutral-800 border border-white/10 rounded-md shadow-lg whitespace-nowrap animate-tooltip-pop">
              {label}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ── Add menu ─────────────────────────────────────────────────────────

interface AddMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onAddExisting: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}

function AddMenu({ anchorRef, onAddExisting, onCreateNew, onClose }: AddMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  // Position relative to anchor button
  const rect = anchorRef.current?.getBoundingClientRect();
  const left = (rect?.right ?? 76) + 8;
  const bottom = rect ? window.innerHeight - rect.bottom : 16;

  return createPortal(
    <div
      ref={ref}
      className="sidebar-add-menu-react fixed z-[10002] flex flex-col py-1 bg-surface border border-border rounded-md shadow-lg overflow-hidden"
      style={{ left, bottom, top: 'auto' }}
    >
      <button
        className="w-full px-3 py-1.5 text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out hover:bg-background-tertiary"
        onClick={() => {
          onClose();
          onAddExisting();
        }}
      >
        Add existing
      </button>
      <button
        className="w-full px-3 py-1.5 text-xs text-text-primary bg-transparent border-none text-left transition-colors duration-100 ease-out hover:bg-background-tertiary"
        onClick={() => {
          onClose();
          onCreateNew();
        }}
      >
        Create new
      </button>
    </div>,
    document.body,
  );
}
