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
}

/** A terminal as the canvas needs to see it: an id to show, and what keys its slot. */
export interface TerminalRef {
  ptyId: string;
  taskId: number | null;
}

interface CanvasStoreState {
  canvasByProject: Record<string, CanvasProjectState>;
}

interface CanvasStoreActions {
  onNodesChange: (projectPath: string, changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (projectPath: string, changes: EdgeChange[]) => void;
  addNode: (projectPath: string, ptyId: string, options?: AddNodeOptions) => void;
  rekeyNode: (projectPath: string, oldPtyId: string, newPtyId: string) => void;
  /** Bring the canvas in line with the project's live terminals. Returns whether anything moved. */
  reconcileNodes: (projectPath: string, terminals: TerminalRef[]) => boolean;
  selectNode: (projectPath: string, ptyId: string) => void;
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

const DEFAULT_NODE_WIDTH = 740;
const DEFAULT_NODE_HEIGHT = 556;
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

function makeNode(
  project: CanvasProjectState,
  projectPath: string,
  ref: TerminalRef,
  position?: { x: number; y: number },
): CanvasNode {
  const id = nextNodeId(project.nodes, canvasNodeBase(ref.taskId));
  const saved = project.layout[id];
  const parentId = saved?.parentId && project.nodes.some((n) => n.id === saved.parentId) ? saved.parentId : undefined;

  return {
    id,
    type: 'terminal',
    position:
      position ?? (saved ? { x: saved.x, y: saved.y } : computeNewNodePosition(project.nodes, project.viewport)),
    data: { ptyId: ref.ptyId, projectPath },
    dragHandle: '.terminal-drag-handle',
    width: saved?.width ?? DEFAULT_NODE_WIDTH,
    height: saved?.height ?? DEFAULT_NODE_HEIGHT,
    ...(parentId ? { parentId } : {}),
  };
}

export const useCanvasStore = create<CanvasStore>()((set, get) => {
  const write = (projectPath: string, next: CanvasProjectState): void =>
    set((s) => ({ canvasByProject: { ...s.canvasByProject, [projectPath]: next } }));

  /** Apply a change to one project's canvas, or do nothing if the project has none yet. */
  const update = (projectPath: string, next: (project: CanvasProjectState) => CanvasProjectState): void => {
    const project = get().canvasByProject[projectPath];
    if (!project) return;
    const changed = next(project);
    if (changed !== project) write(projectPath, changed);
  };

  return {
    canvasByProject: {},

    ensureProject: (projectPath) => {
      if (get().canvasByProject[projectPath]) return;
      write(projectPath, emptyProjectState());
    },

    onNodesChange: (projectPath, changes) =>
      update(projectPath, (project) => ({
        ...project,
        // A remove change would drop the node without banking its geometry.
        // Removal belongs to reconcileNodes, which does.
        nodes: applyNodeChanges(
          changes.filter((c) => c.type !== 'remove'),
          project.nodes,
        ) as CanvasNode[],
      })),

    onEdgesChange: (projectPath, changes) =>
      update(projectPath, (project) => ({ ...project, edges: applyEdgeChanges(changes, project.edges) })),

    addNode: (projectPath, ptyId, options = {}) => {
      const project = get().canvasByProject[projectPath] ?? emptyProjectState();
      if (project.nodes.some((n) => n.data.ptyId === ptyId)) return;
      const node = makeNode(project, projectPath, { ptyId, taskId: options.taskId ?? null }, options.position);
      write(projectPath, { ...project, nodes: [...project.nodes, node] });
    },

    rekeyNode: (projectPath, oldPtyId, newPtyId) => {
      if (oldPtyId === newPtyId) return;
      update(projectPath, (project) => ({
        ...project,
        nodes: project.nodes.map((n) =>
          n.data.ptyId === oldPtyId ? { ...n, data: { ...n.data, ptyId: newPtyId } } : n,
        ),
      }));
    },

    reconcileNodes: (projectPath, terminals) => {
      const project = get().canvasByProject[projectPath];
      if (!project) return false;

      const live = new Set(terminals.map((t) => t.ptyId));
      const onCanvas = new Set(project.nodes.filter((n) => !isGroupNode(n)).map((n) => n.data.ptyId));
      const gone = project.nodes.filter((n) => !isGroupNode(n) && !live.has(n.data.ptyId));
      const arrived = terminals.filter((t) => !onCanvas.has(t.ptyId));
      if (gone.length === 0 && arrived.length === 0) return false;

      const goneIds = new Set(gone.map((n) => n.id));
      const layout = { ...project.layout };
      for (const node of gone) layout[node.id] = layoutOf(node);

      // Departures are banked before arrivals are placed, so a terminal that
      // reopens for the same task reclaims the ordinal — and with it the
      // position — the closed one had.
      const nodes = pruneEmptyGroups(project.nodes.filter((n) => !goneIds.has(n.id)));
      for (const ref of arrived) nodes.push(makeNode({ ...project, nodes, layout }, projectPath, ref));

      write(projectPath, {
        ...project,
        nodes,
        edges: project.edges.filter((e) => !goneIds.has(e.source) && !goneIds.has(e.target)),
        layout,
      });
      return true;
    },

    selectNode: (projectPath, ptyId) =>
      update(projectPath, (project) => {
        let changed = false;
        const nodes = project.nodes.map((n) => {
          const selected = !isGroupNode(n) && n.data.ptyId === ptyId;
          if (!!n.selected === selected) return n;
          changed = true;
          return { ...n, selected };
        });
        return changed ? { ...project, nodes } : project;
      }),

    setViewport: (projectPath, viewport) => update(projectPath, (project) => ({ ...project, viewport })),

    setNodes: (projectPath, nodes) => update(projectPath, (project) => ({ ...project, nodes })),

    setEdges: (projectPath, edges) => update(projectPath, (project) => ({ ...project, edges })),

    setGridSnap: (projectPath, snap) => update(projectPath, (project) => ({ ...project, gridSnap: snap })),

    groupSelected: (projectPath) =>
      update(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected && !isGroupNode(n) && !n.parentId);
        if (selected.length < 2) return project;

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
        return { ...project, nodes: [groupNode, ...children] };
      }),

    ungroupSelected: (projectPath) =>
      update(projectPath, (project) => {
        const groupIds = new Set<string>();
        for (const node of project.nodes) {
          if (node.selected && isGroupNode(node)) groupIds.add(node.id);
          if (node.selected && node.parentId) groupIds.add(node.parentId);
        }
        if (groupIds.size === 0) return project;

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

        return { ...project, nodes };
      }),

    alignSelected: (projectPath, type) =>
      update(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 2) return project;

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

        return {
          ...project,
          nodes: project.nodes.map((n) => (n.selected ? { ...n, position: { x: placeX(n), y: placeY(n) } } : n)),
        };
      }),

    distributeSelected: (projectPath, axis) =>
      update(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 3) return project;

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

        return {
          ...project,
          nodes: project.nodes.map((n) => {
            const coord = placed.get(n.id);
            if (coord === undefined) return n;
            return { ...n, position: horizontal ? { x: coord, y: n.position.y } : { x: n.position.x, y: coord } };
          }),
        };
      }),

    gridLayoutSelected: (projectPath) =>
      update(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 2) return project;

        const cols = Math.ceil(Math.sqrt(selected.length));
        const sorted = [...selected].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

        const colWidths: number[] = [];
        const rowHeights: number[] = [];
        sorted.forEach((node, i) => {
          colWidths[i % cols] = Math.max(colWidths[i % cols] ?? 0, nodeWidth(node));
          rowHeights[Math.floor(i / cols)] = Math.max(rowHeights[Math.floor(i / cols)] ?? 0, nodeHeight(node));
        });

        const originX = Math.min(...selected.map((n) => n.position.x));
        const originY = Math.min(...selected.map((n) => n.position.y));

        const placed = new Map<string, { x: number; y: number }>();
        sorted.forEach((node, i) => {
          placed.set(node.id, {
            x: originX + colWidths.slice(0, i % cols).reduce((s, w) => s + w + GRID_GAP, 0),
            y: originY + rowHeights.slice(0, Math.floor(i / cols)).reduce((s, h) => s + h + GRID_GAP, 0),
          });
        });

        return { ...project, nodes: project.nodes.map((n) => ({ ...n, position: placed.get(n.id) ?? n.position })) };
      }),

    commitLayout: (projectPath) =>
      update(projectPath, (project) => {
        const layout = { ...project.layout };
        for (const node of project.nodes) {
          if (!isGroupNode(node)) layout[node.id] = layoutOf(node);
        }
        return { ...project, layout: capLayout(layout, project.nodes) };
      }),

    loadCanvas: (projectPath, persisted) => {
      write(projectPath, {
        nodes: persisted.groups.map((g) => ({
          id: g.id,
          type: 'group',
          position: g.position,
          data: { ptyId: g.id, projectPath },
          width: g.width,
          height: g.height,
        })),
        edges: [],
        viewport: persisted.viewport,
        gridSnap: persisted.gridSnap,
        layout: persisted.layout,
      });
    },
  };
});

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
