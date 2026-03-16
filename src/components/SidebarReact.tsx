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
import { stringToColor, getInitials } from '../utils/projectIcon';

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

  const sidebarRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    sidebarRef.current?.classList.add('sidebar--visible');
    document.documentElement.style.setProperty('--sidebar-offset', 'var(--sidebar-width)');
  }, []);

  const hideSidebar = useCallback(() => {
    if (addMenuOpen) return;
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    hideTimeoutRef.current = setTimeout(() => {
      sidebarRef.current?.classList.remove('sidebar--visible');
      document.documentElement.style.setProperty('--sidebar-offset', '0px');
    }, 300);
  }, [addMenuOpen]);

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
      {/* Trigger zone */}
      <div
        ref={triggerRef}
        className="sidebar-trigger"
        onMouseEnter={(e) => {
          if (e.buttons !== 0) return;
          showTimeoutRef.current = setTimeout(showSidebar, 200);
        }}
        onMouseLeave={() => {
          if (showTimeoutRef.current) {
            clearTimeout(showTimeoutRef.current);
            showTimeoutRef.current = null;
          }
        }}
      />

      {/* Sidebar */}
      <aside ref={sidebarRef} className="sidebar" onMouseEnter={showSidebar} onMouseLeave={hideSidebar}>
        <div className="sidebar-drag-region" />

        {/* Home button */}
        <div
          className={`sidebar-home ${activeView === 'home' ? 'sidebar-home--active' : ''}`}
          onClick={onHomeSelect}
          title="Sessions"
        >
          <div className="sidebar-pill" />
          <div className="sidebar-icon">
            <div className="sidebar-home-logo" />
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Project list with drag-to-reorder */}
        <div className="sidebar-projects">
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
          <button
            ref={addBtnRef}
            className="sidebar-action-btn"
            title="Add project"
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
          className="task-context-menu task-context-menu--visible sidebar-context-menu-react"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 120),
            top: Math.min(contextMenu.y, window.innerHeight - 40),
          }}
        >
          <button
            className="task-context-menu-item task-context-menu-item--danger"
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
        style={style}
        {...attributes}
        {...getTipRefProps()}
        {...listeners}
        className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}
        data-project-path={project.path}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <div className="sidebar-pill" />
        <div className="sidebar-icon">
          {project.iconDataUrl ? (
            <img src={project.iconDataUrl} alt={project.name} className="sidebar-icon-image" draggable={false} />
          ) : (
            <div className="sidebar-icon-placeholder" style={{ backgroundColor: stringToColor(project.name) }}>
              {getInitials(project.name)}
            </div>
          )}
        </div>
      </div>
      {tipOpen &&
        !isDragging &&
        createPortal(
          <div
            ref={tipRefs.setFloating}
            className="fixed z-[10000] px-3 py-1.5 text-[13px] font-medium text-white bg-neutral-800 border border-white/10 rounded-md shadow-lg pointer-events-none whitespace-nowrap"
            style={tipStyles}
            {...getTipFloatProps()}
          >
            {project.name}
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
    requestAnimationFrame(() => ref.current?.classList.add('sidebar-add-menu--visible'));
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
      className="sidebar-add-menu sidebar-add-menu-react"
      style={{ position: 'fixed', left, bottom, top: 'auto' }}
    >
      <button
        className="sidebar-add-menu-item"
        onClick={() => {
          onClose();
          onAddExisting();
        }}
      >
        Add existing folder
      </button>
      <button
        className="sidebar-add-menu-item"
        onClick={() => {
          onClose();
          onCreateNew();
        }}
      >
        Create new project
      </button>
    </div>,
    document.body,
  );
}
