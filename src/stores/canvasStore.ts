import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Viewport,
} from '@xyflow/react';

// ── Types ────────────────────────────────────────────────────────────

export interface TerminalNodeData extends Record<string, unknown> {
  ptyId: string;
  projectPath: string;
}

export type TerminalNode = Node<TerminalNodeData, 'terminal'>;

export interface CanvasProjectState {
  nodes: TerminalNode[];
  edges: Edge[];
  viewport: Viewport;
  gridSnap: boolean;
}

interface CanvasStoreState {
  canvasByProject: Record<string, CanvasProjectState>;
}

interface CanvasStoreActions {
  onNodesChange: (projectPath: string, changes: NodeChange<TerminalNode>[]) => void;
  onEdgesChange: (projectPath: string, changes: EdgeChange[]) => void;
  addNode: (projectPath: string, ptyId: string, position?: { x: number; y: number }) => void;
  removeNode: (projectPath: string, ptyId: string) => void;
  setViewport: (projectPath: string, viewport: Viewport) => void;
  setEdges: (projectPath: string, edges: Edge[]) => void;
  setGridSnap: (projectPath: string, snap: boolean) => void;
  groupSelected: (projectPath: string) => void;
  ungroupSelected: (projectPath: string) => void;
  loadCanvas: (projectPath: string, state: CanvasProjectState) => void;
  ensureProject: (projectPath: string) => void;
}

type CanvasStore = CanvasStoreState & CanvasStoreActions;

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_NODE_WIDTH = 740;
const DEFAULT_NODE_HEIGHT = 556;
const NODE_SPACING = 60;

function emptyProjectState(): CanvasProjectState {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    gridSnap: false,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Compute position for a new node, avoiding overlaps. */
function computeNewNodePosition(
  existing: TerminalNode[],
  viewport: Viewport,
  hint?: { x: number; y: number },
): { x: number; y: number } {
  if (hint) return hint;

  // Find the selected node and place next to it
  const selected = existing.find((n) => n.selected);
  if (selected) {
    const sx =
      (selected.position.x ?? 0) +
      (selected.style?.width ? Number(selected.style.width) : DEFAULT_NODE_WIDTH) +
      NODE_SPACING;
    const sy = selected.position.y ?? 0;
    return cascadeIfOccupied(existing, sx, sy);
  }

  // No selection — place at viewport center
  const cx = (-viewport.x + 400) / viewport.zoom;
  const cy = (-viewport.y + 300) / viewport.zoom;
  return cascadeIfOccupied(existing, cx, cy);
}

/** If a node already occupies the target position, cascade down-right. */
function cascadeIfOccupied(existing: TerminalNode[], x: number, y: number): { x: number; y: number } {
  const threshold = 40;
  let pos = { x, y };
  let attempts = 0;
  while (attempts < 20) {
    const overlap = existing.some(
      (n) => Math.abs(n.position.x - pos.x) < threshold && Math.abs(n.position.y - pos.y) < threshold,
    );
    if (!overlap) break;
    pos = { x: pos.x + NODE_SPACING, y: pos.y + NODE_SPACING };
    attempts++;
  }
  return pos;
}

// ── Store ────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  canvasByProject: {},

  ensureProject: (projectPath) => {
    const state = get();
    if (state.canvasByProject[projectPath]) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: emptyProjectState(),
      },
    });
  },

  onNodesChange: (projectPath, changes) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    // Filter out remove changes — we manage node removal ourselves via removeNode
    const safeChanges = changes.filter((c) => c.type !== 'remove');

    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: {
          ...project,
          nodes: applyNodeChanges(safeChanges, project.nodes) as TerminalNode[],
        },
      },
    });
  },

  onEdgesChange: (projectPath, changes) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: {
          ...project,
          edges: applyEdgeChanges(changes, project.edges),
        },
      },
    });
  },

  addNode: (projectPath, ptyId, position) => {
    const state = get();
    const project = state.canvasByProject[projectPath] ?? emptyProjectState();

    // Don't add duplicate nodes
    if (project.nodes.some((n) => n.id === ptyId)) return;

    const pos = computeNewNodePosition(project.nodes, project.viewport, position);

    const node: TerminalNode = {
      id: ptyId,
      type: 'terminal',
      position: pos,
      data: { ptyId, projectPath },
      dragHandle: '.terminal-drag-handle',
      style: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    };

    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: {
          ...project,
          nodes: [...project.nodes, node],
        },
      },
    });
  },

  removeNode: (projectPath, ptyId) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: {
          ...project,
          nodes: project.nodes.filter((n) => n.id !== ptyId),
          edges: project.edges.filter((e) => e.source !== ptyId && e.target !== ptyId),
        },
      },
    });
  },

  setViewport: (projectPath, viewport) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: { ...project, viewport },
      },
    });
  },

  setEdges: (projectPath, edges) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: { ...project, edges },
      },
    });
  },

  setGridSnap: (projectPath, snap) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: { ...project, gridSnap: snap },
      },
    });
  },

  groupSelected: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    const selected = project.nodes.filter((n) => n.selected && n.type === 'terminal');
    if (selected.length < 2) return;

    // Compute bounding box of selected nodes
    const bounds = selected.reduce(
      (acc, n) => {
        const w = n.style?.width ? Number(n.style.width) : DEFAULT_NODE_WIDTH;
        const h = n.style?.height ? Number(n.style.height) : DEFAULT_NODE_HEIGHT;
        return {
          minX: Math.min(acc.minX, n.position.x),
          minY: Math.min(acc.minY, n.position.y),
          maxX: Math.max(acc.maxX, n.position.x + w),
          maxY: Math.max(acc.maxY, n.position.y + h),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );

    const padding = 20;
    const groupId = `group-${Date.now()}`;

    // Create group parent node
    const groupNode: TerminalNode = {
      id: groupId,
      type: 'terminal',
      position: { x: bounds.minX - padding, y: bounds.minY - padding },
      data: { ptyId: groupId, projectPath },
      style: {
        width: bounds.maxX - bounds.minX + padding * 2,
        height: bounds.maxY - bounds.minY + padding * 2,
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px dashed rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
      },
    } as TerminalNode;

    // Reparent selected nodes under the group
    const updatedNodes = project.nodes.map((n) => {
      if (!n.selected || n.type !== 'terminal') return n;
      return {
        ...n,
        parentId: groupId,
        position: {
          x: n.position.x - groupNode.position.x,
          y: n.position.y - groupNode.position.y,
        },
        selected: false,
      };
    });

    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: {
          ...project,
          nodes: [groupNode, ...updatedNodes] as TerminalNode[],
        },
      },
    });
  },

  ungroupSelected: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    // Find selected group nodes (nodes that are parents of others)
    const selectedIds = new Set(project.nodes.filter((n) => n.selected).map((n) => n.id));
    const groupIds = new Set<string>();

    // Find groups: any selected node that is a parentId of another node
    for (const node of project.nodes) {
      if (node.parentId && selectedIds.has(node.parentId)) {
        groupIds.add(node.parentId);
      }
    }

    // Also consider: if a selected node has a parentId, ungroup from its parent
    for (const node of project.nodes) {
      if (node.selected && node.parentId) {
        groupIds.add(node.parentId);
      }
    }

    if (groupIds.size === 0) return;

    // Flatten children of groups back to root level
    const updatedNodes: TerminalNode[] = [];
    for (const node of project.nodes) {
      if (groupIds.has(node.id) && node.id.startsWith('group-')) {
        // Remove group node itself
        continue;
      }
      if (node.parentId && groupIds.has(node.parentId)) {
        // Move child to absolute position
        const parent = project.nodes.find((n) => n.id === node.parentId);
        const parentX = parent?.position.x ?? 0;
        const parentY = parent?.position.y ?? 0;
        updatedNodes.push({
          ...node,
          parentId: undefined,
          position: {
            x: node.position.x + parentX,
            y: node.position.y + parentY,
          },
        } as TerminalNode);
      } else {
        updatedNodes.push(node);
      }
    }

    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: { ...project, nodes: updatedNodes },
      },
    });
  },

  loadCanvas: (projectPath, loaded) => {
    const state = get();
    set({
      canvasByProject: {
        ...state.canvasByProject,
        [projectPath]: loaded,
      },
    });
  },
}));

// ── Persistence ──────────────────────────────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced save of canvas state for a project. */
export function persistCanvas(projectPath: string): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const project = useCanvasStore.getState().canvasByProject[projectPath];
    if (!project) return;

    // Strip transient properties before serializing
    const nodes = project.nodes.map(({ selected: _s, dragging: _d, measured: _m, ...rest }) => rest) as TerminalNode[];
    const edges = project.edges.map(({ selected: _sel, ...rest }) => rest);
    const serializable: CanvasProjectState = {
      nodes,
      edges,
      viewport: project.viewport,
      gridSnap: project.gridSnap,
    };

    window.api.globalSettings.set('canvas:' + projectPath, JSON.stringify(serializable));
  }, 300);
}

/** Load canvas state from persistence, returns null if none saved. */
export async function loadPersistedCanvas(projectPath: string): Promise<CanvasProjectState | null> {
  const json = await window.api.globalSettings.get('canvas:' + projectPath);
  if (!json) return null;
  try {
    return JSON.parse(json) as CanvasProjectState;
  } catch {
    return null;
  }
}
