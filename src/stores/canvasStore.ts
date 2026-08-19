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

export interface CanvasNodeData extends Record<string, unknown> {
  ptyId: string;
  projectPath: string;
  loading?: boolean;
  loadingLabel?: string;
}

export type CanvasNode = Node<CanvasNodeData, 'terminal' | 'group'>;

/**
 * Geometry remembered against a node's stable id. It outlives the node, so a
 * terminal that is closed and reopened — or a whole app restart, which hands
 * every session a new PTY id — lands back where the user put it.
 */
export interface NodeLayout {
  x: number;
  y: number;
  width?: number;
  height?: number;
  parentId?: string;
}

export interface CanvasProjectState {
  nodes: CanvasNode[];
  edges: Edge[];
  viewport: Viewport;
  gridSnap: boolean;
  layout: Record<string, NodeLayout>;
}

/** What survives a quit: geometry plus the groups the user drew around it. */
interface PersistedCanvas {
  version: 2;
  layout: Record<string, NodeLayout>;
  groups: Array<{ id: string; position: { x: number; y: number }; width?: number; height?: number }>;
  viewport: Viewport;
  gridSnap: boolean;
}

export type AlignType = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

interface AddNodeOptions {
  /** Task the terminal belongs to; null for a bare project shell. */
  taskId?: number | null;
  position?: { x: number; y: number };
  loading?: boolean;
  loadingLabel?: string;
}

interface CanvasStoreState {
  canvasByProject: Record<string, CanvasProjectState>;
}

interface CanvasStoreActions {
  onNodesChange: (projectPath: string, changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (projectPath: string, changes: EdgeChange[]) => void;
  addNode: (projectPath: string, ptyId: string, options?: AddNodeOptions) => void;
  removeNode: (projectPath: string, ptyId: string) => void;
  rekeyNode: (projectPath: string, oldPtyId: string, newPtyId: string) => void;
  setViewport: (projectPath: string, viewport: Viewport) => void;
  setNodes: (projectPath: string, nodes: CanvasNode[]) => void;
  setEdges: (projectPath: string, edges: Edge[]) => void;
  setGridSnap: (projectPath: string, snap: boolean) => void;
  groupSelected: (projectPath: string) => void;
  ungroupSelected: (projectPath: string) => void;
  alignSelected: (projectPath: string, type: AlignType) => void;
  distributeSelected: (projectPath: string, axis: DistributeAxis) => void;
  gridLayoutSelected: (projectPath: string) => void;
  commitLayout: (projectPath: string) => void;
  loadCanvas: (projectPath: string, persisted: PersistedCanvas) => void;
  ensureProject: (projectPath: string) => void;
}

type CanvasStore = CanvasStoreState & CanvasStoreActions;

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_NODE_WIDTH = 740;
export const DEFAULT_NODE_HEIGHT = 556;
const NODE_SPACING = 60;
const GROUP_PADDING = 20;
const GRID_GAP = 24;

/**
 * Layout entries deliberately outlive their nodes, so nothing prunes them as
 * tasks come and go. Cap the map — entries with no node on the canvas go
 * first, oldest inserted first — so a long-lived project can't grow an
 * unbounded blob in global settings.
 */
const MAX_LAYOUT_ENTRIES = 200;

function emptyProjectState(): CanvasProjectState {
  return {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    gridSnap: false,
    layout: {},
  };
}

// ── Node identity ────────────────────────────────────────────────────

/**
 * The stable half of a node's id. A PTY id is new on every launch, so nodes
 * are keyed by what does survive — the task a terminal belongs to, or the
 * project's pool of bare shells — with an ordinal separating siblings.
 */
export function canvasNodeBase(taskId: number | null | undefined): string {
  return taskId == null ? 'shell' : `task-${taskId}`;
}

/** Lowest ordinal not currently on the canvas, so a reopened terminal reclaims its slot. */
function nextNodeId(nodes: CanvasNode[], base: string): string {
  for (let ordinal = 0; ; ordinal++) {
    const id = `${base}#${ordinal}`;
    if (!nodes.some((n) => n.id === id)) return id;
  }
}

export function isGroupNode(node: CanvasNode): boolean {
  return node.type === 'group';
}

// ── Geometry helpers ─────────────────────────────────────────────────

// A resize writes node.width/height; `measured` is what the DOM reports, which
// lags a frame behind and is absent before the first render.
export function nodeWidth(node: CanvasNode): number {
  return node.width ?? node.measured?.width ?? DEFAULT_NODE_WIDTH;
}

export function nodeHeight(node: CanvasNode): number {
  return node.height ?? node.measured?.height ?? DEFAULT_NODE_HEIGHT;
}

function layoutOf(node: CanvasNode): NodeLayout {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
    parentId: node.parentId,
  };
}

/** Compute position for a new node, avoiding overlaps. */
function computeNewNodePosition(existing: CanvasNode[], viewport: Viewport): { x: number; y: number } {
  const selected = existing.find((n) => n.selected);
  if (selected) {
    return cascadeIfOccupied(existing, selected.position.x + nodeWidth(selected) + NODE_SPACING, selected.position.y);
  }

  const cx = (-viewport.x + 400) / viewport.zoom;
  const cy = (-viewport.y + 300) / viewport.zoom;
  return cascadeIfOccupied(existing, cx, cy);
}

/** If a node already occupies the target position, cascade down-right. */
function cascadeIfOccupied(existing: CanvasNode[], x: number, y: number): { x: number; y: number } {
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

/** Drop group containers whose last child has gone. */
function pruneEmptyGroups(nodes: CanvasNode[]): CanvasNode[] {
  const occupied = new Set(nodes.map((n) => n.parentId).filter(Boolean) as string[]);
  return nodes.filter((n) => !isGroupNode(n) || occupied.has(n.id));
}

function capLayout(layout: Record<string, NodeLayout>, nodes: CanvasNode[]): Record<string, NodeLayout> {
  const keys = Object.keys(layout);
  if (keys.length <= MAX_LAYOUT_ENTRIES) return layout;

  const live = new Set(nodes.map((n) => n.id));
  const evictable = keys.filter((k) => !live.has(k));
  const dropCount = Math.min(evictable.length, keys.length - MAX_LAYOUT_ENTRIES);
  if (dropCount === 0) return layout;

  const dropped = new Set(evictable.slice(0, dropCount));
  return Object.fromEntries(keys.filter((k) => !dropped.has(k)).map((k) => [k, layout[k]]));
}

// ── Store ────────────────────────────────────────────────────────────

function patch(
  set: (partial: Partial<CanvasStoreState>) => void,
  state: CanvasStoreState,
  projectPath: string,
  next: CanvasProjectState,
): void {
  set({ canvasByProject: { ...state.canvasByProject, [projectPath]: next } });
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  canvasByProject: {},

  ensureProject: (projectPath) => {
    const state = get();
    if (state.canvasByProject[projectPath]) return;
    patch(set, state, projectPath, emptyProjectState());
  },

  onNodesChange: (projectPath, changes) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    // Node removal goes through removeNode, which also banks the geometry.
    const safeChanges = changes.filter((c) => c.type !== 'remove');

    patch(set, state, projectPath, {
      ...project,
      nodes: applyNodeChanges(safeChanges, project.nodes) as CanvasNode[],
    });
  },

  onEdgesChange: (projectPath, changes) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    patch(set, state, projectPath, { ...project, edges: applyEdgeChanges(changes, project.edges) });
  },

  addNode: (projectPath, ptyId, options = {}) => {
    const state = get();
    const project = state.canvasByProject[projectPath] ?? emptyProjectState();
    if (project.nodes.some((n) => n.data.ptyId === ptyId)) return;

    const id = nextNodeId(project.nodes, canvasNodeBase(options.taskId));
    const saved = project.layout[id];
    const position =
      options.position ??
      (saved ? { x: saved.x, y: saved.y } : computeNewNodePosition(project.nodes, project.viewport));
    const parentId = saved?.parentId && project.nodes.some((n) => n.id === saved.parentId) ? saved.parentId : undefined;

    const node: CanvasNode = {
      id,
      type: 'terminal',
      position,
      data: { ptyId, projectPath, loading: options.loading, loadingLabel: options.loadingLabel },
      dragHandle: '.terminal-drag-handle',
      width: saved?.width ?? DEFAULT_NODE_WIDTH,
      height: saved?.height ?? DEFAULT_NODE_HEIGHT,
      ...(parentId ? { parentId } : {}),
    };

    patch(set, state, projectPath, { ...project, nodes: [...project.nodes, node] });
  },

  removeNode: (projectPath, ptyId) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    const node = project.nodes.find((n) => n.data.ptyId === ptyId && !isGroupNode(n));
    if (!node) return;

    patch(set, state, projectPath, {
      ...project,
      nodes: pruneEmptyGroups(project.nodes.filter((n) => n.id !== node.id)),
      edges: project.edges.filter((e) => e.source !== node.id && e.target !== node.id),
      layout: { ...project.layout, [node.id]: layoutOf(node) },
    });
  },

  rekeyNode: (projectPath, oldPtyId, newPtyId) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project || oldPtyId === newPtyId) return;

    patch(set, state, projectPath, {
      ...project,
      nodes: project.nodes.map((n) =>
        n.data.ptyId === oldPtyId
          ? { ...n, data: { ...n.data, ptyId: newPtyId, loading: false, loadingLabel: undefined } }
          : n,
      ),
    });
  },

  setViewport: (projectPath, viewport) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    patch(set, state, projectPath, { ...project, viewport });
  },

  setNodes: (projectPath, nodes) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    patch(set, state, projectPath, { ...project, nodes });
  },

  setEdges: (projectPath, edges) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    patch(set, state, projectPath, { ...project, edges });
  },

  setGridSnap: (projectPath, snap) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    patch(set, state, projectPath, { ...project, gridSnap: snap });
  },

  groupSelected: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    const selected = project.nodes.filter((n) => n.selected && !isGroupNode(n) && !n.parentId);
    if (selected.length < 2) return;

    const bounds = selected.reduce(
      (acc, n) => ({
        minX: Math.min(acc.minX, n.position.x),
        minY: Math.min(acc.minY, n.position.y),
        maxX: Math.max(acc.maxX, n.position.x + nodeWidth(n)),
        maxY: Math.max(acc.maxY, n.position.y + nodeHeight(n)),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );

    const groupId = nextNodeId(project.nodes, 'group');
    const groupNode: CanvasNode = {
      id: groupId,
      type: 'group',
      position: { x: bounds.minX - GROUP_PADDING, y: bounds.minY - GROUP_PADDING },
      data: { ptyId: groupId, projectPath },
      width: bounds.maxX - bounds.minX + GROUP_PADDING * 2,
      height: bounds.maxY - bounds.minY + GROUP_PADDING * 2,
    };

    const selectedIds = new Set(selected.map((n) => n.id));
    const children = project.nodes.map((n) =>
      selectedIds.has(n.id)
        ? {
            ...n,
            parentId: groupId,
            position: { x: n.position.x - groupNode.position.x, y: n.position.y - groupNode.position.y },
            selected: false,
          }
        : n,
    );

    // React Flow requires a parent to precede its children in the array.
    patch(set, state, projectPath, { ...project, nodes: [groupNode, ...children] });
  },

  ungroupSelected: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    const groupIds = new Set<string>();
    for (const node of project.nodes) {
      if (node.selected && isGroupNode(node)) groupIds.add(node.id);
      if (node.selected && node.parentId) groupIds.add(node.parentId);
    }
    if (groupIds.size === 0) return;

    const nodes: CanvasNode[] = [];
    for (const node of project.nodes) {
      if (isGroupNode(node) && groupIds.has(node.id)) continue;
      if (node.parentId && groupIds.has(node.parentId)) {
        const parent = project.nodes.find((n) => n.id === node.parentId);
        nodes.push({
          ...node,
          parentId: undefined,
          position: {
            x: node.position.x + (parent?.position.x ?? 0),
            y: node.position.y + (parent?.position.y ?? 0),
          },
        });
      } else {
        nodes.push(node);
      }
    }

    patch(set, state, projectPath, { ...project, nodes });
  },

  alignSelected: (projectPath, type) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    const selected = project.nodes.filter((n) => n.selected);
    if (selected.length < 2) return;

    const minX = Math.min(...selected.map((n) => n.position.x));
    const maxRight = Math.max(...selected.map((n) => n.position.x + nodeWidth(n)));
    const minY = Math.min(...selected.map((n) => n.position.y));
    const maxBottom = Math.max(...selected.map((n) => n.position.y + nodeHeight(n)));

    const placeX = (n: CanvasNode): number => {
      switch (type) {
        case 'left':
          return minX;
        case 'right':
          return maxRight - nodeWidth(n);
        case 'center-h':
          return (minX + maxRight) / 2 - nodeWidth(n) / 2;
        default:
          return n.position.x;
      }
    };
    const placeY = (n: CanvasNode): number => {
      switch (type) {
        case 'top':
          return minY;
        case 'bottom':
          return maxBottom - nodeHeight(n);
        case 'center-v':
          return (minY + maxBottom) / 2 - nodeHeight(n) / 2;
        default:
          return n.position.y;
      }
    };

    patch(set, state, projectPath, {
      ...project,
      nodes: project.nodes.map((n) => (n.selected ? { ...n, position: { x: placeX(n), y: placeY(n) } } : n)),
    });
  },

  distributeSelected: (projectPath, axis) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    const selected = project.nodes.filter((n) => n.selected);
    if (selected.length < 3) return;

    const horizontal = axis === 'horizontal';
    const at = (n: CanvasNode) => (horizontal ? n.position.x : n.position.y);
    const extent = horizontal ? nodeWidth : nodeHeight;

    const sorted = [...selected].sort((a, b) => at(a) - at(b));
    const last = sorted[sorted.length - 1];
    const start = at(sorted[0]);
    const span = at(last) + extent(last) - start;
    const gap = (span - sorted.reduce((sum, n) => sum + extent(n), 0)) / (sorted.length - 1);

    let cursor = start;
    const placed = new Map<string, number>();
    for (const node of sorted) {
      placed.set(node.id, cursor);
      cursor += extent(node) + gap;
    }

    patch(set, state, projectPath, {
      ...project,
      nodes: project.nodes.map((n) => {
        const coord = placed.get(n.id);
        if (coord === undefined) return n;
        return {
          ...n,
          position: horizontal ? { x: coord, y: n.position.y } : { x: n.position.x, y: coord },
        };
      }),
    });
  },

  gridLayoutSelected: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;
    const selected = project.nodes.filter((n) => n.selected);
    if (selected.length < 2) return;

    const cols = Math.ceil(Math.sqrt(selected.length));
    const sorted = [...selected].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

    const colWidths: number[] = [];
    const rowHeights: number[] = [];
    sorted.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      colWidths[col] = Math.max(colWidths[col] ?? 0, nodeWidth(node));
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, nodeHeight(node));
    });

    const originX = Math.min(...selected.map((n) => n.position.x));
    const originY = Math.min(...selected.map((n) => n.position.y));

    const placed = new Map<string, { x: number; y: number }>();
    sorted.forEach((node, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      placed.set(node.id, {
        x: originX + colWidths.slice(0, col).reduce((s, w) => s + w + GRID_GAP, 0),
        y: originY + rowHeights.slice(0, row).reduce((s, h) => s + h + GRID_GAP, 0),
      });
    });

    patch(set, state, projectPath, {
      ...project,
      nodes: project.nodes.map((n) => ({ ...n, position: placed.get(n.id) ?? n.position })),
    });
  },

  commitLayout: (projectPath) => {
    const state = get();
    const project = state.canvasByProject[projectPath];
    if (!project) return;

    const layout = { ...project.layout };
    for (const node of project.nodes) {
      if (isGroupNode(node)) continue;
      layout[node.id] = layoutOf(node);
    }
    patch(set, state, projectPath, { ...project, layout: capLayout(layout, project.nodes) });
  },

  loadCanvas: (projectPath, persisted) => {
    const state = get();
    const groups: CanvasNode[] = persisted.groups.map((g) => ({
      id: g.id,
      type: 'group',
      position: g.position,
      data: { ptyId: g.id, projectPath },
      width: g.width,
      height: g.height,
    }));

    patch(set, state, projectPath, {
      nodes: groups,
      edges: [],
      viewport: persisted.viewport,
      gridSnap: persisted.gridSnap,
      layout: persisted.layout,
    });
  },
}));

// ── Persistence ──────────────────────────────────────────────────────

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function settingsKey(projectPath: string): string {
  return 'canvas:' + projectPath;
}

/** Debounced save of canvas geometry for a project. */
export function persistCanvas(projectPath: string): void {
  const pending = persistTimers.get(projectPath);
  if (pending) clearTimeout(pending);
  persistTimers.set(
    projectPath,
    setTimeout(() => {
      persistTimers.delete(projectPath);
      useCanvasStore.getState().commitLayout(projectPath);
      const project = useCanvasStore.getState().canvasByProject[projectPath];
      if (!project) return;

      const payload: PersistedCanvas = {
        version: 2,
        layout: project.layout,
        groups: project.nodes
          .filter(isGroupNode)
          .map((n) => ({ id: n.id, position: n.position, width: n.width, height: n.height })),
        viewport: project.viewport,
        gridSnap: project.gridSnap,
      };
      void window.api.globalSettings.set(settingsKey(projectPath), JSON.stringify(payload));
    }, 300),
  );
}

/**
 * Read saved geometry. Returns null when nothing is saved, or when the blob
 * predates version 2 — those nodes were keyed by PTY id, which no longer
 * identifies anything after a relaunch.
 */
export async function loadPersistedCanvas(projectPath: string): Promise<PersistedCanvas | null> {
  const json = await window.api.globalSettings.get(settingsKey(projectPath));
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<PersistedCanvas>;
    if (parsed.version !== 2 || !parsed.layout || !parsed.viewport) return null;
    return {
      version: 2,
      layout: parsed.layout,
      groups: parsed.groups ?? [],
      viewport: parsed.viewport,
      gridSnap: parsed.gridSnap ?? false,
    };
  } catch {
    return null;
  }
}
