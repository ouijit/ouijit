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
import { isChainMember, type TaskChainInfo } from '../utils/taskChain';

// ── Types ────────────────────────────────────────────────────────────

export interface CanvasNodeData extends Record<string, unknown> {
  ptyId: string;
  projectPath: string;
}

export type TerminalCanvasNode = Node<CanvasNodeData, 'terminal'>;

/** Chrome the user draws around terminals; there is no session behind it. */
export type GroupCanvasNode = Node<Record<string, never>, 'group'>;

export type CanvasNode = TerminalCanvasNode | GroupCanvasNode;

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

export interface TerminalRef {
  ptyId: string;
  /** Task the terminal belongs to; null for a bare project shell. */
  taskId: number | null;
}

interface CanvasStoreState {
  canvasByProject: Record<string, CanvasProjectState>;
}

interface CanvasStoreActions {
  onNodesChange: (projectPath: string, changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (projectPath: string, changes: EdgeChange[]) => void;
  /** Bring the canvas in line with the project's live terminals. */
  reconcileNodes: (projectPath: string, terminals: TerminalRef[]) => void;
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
  chainLayout: (
    projectPath: string,
    chainMap: Map<number, TaskChainInfo>,
    nodesByTask: Map<number, CanvasNode[]>,
  ) => void;
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
const CHAIN_H_GAP = 80;
const CHAIN_V_GAP = 60;

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

export function isGroupNode(node: CanvasNode): node is GroupCanvasNode {
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

/**
 * Geometry for everything on the canvas now, laid over what was banked for the
 * nodes that have left. Built at save time rather than kept in the store: only
 * a node that is *not* on the canvas is ever read back out of `layout`.
 */
function layoutSnapshot(project: CanvasProjectState): Record<string, NodeLayout> {
  const layout = { ...project.layout };
  for (const node of project.nodes) {
    if (!isGroupNode(node)) layout[node.id] = layoutOf(node);
  }
  return capLayout(layout, project.nodes);
}

/** Reading and measuring a node along one axis. */
function axisOf(horizontal: boolean) {
  return {
    at: (n: CanvasNode) => (horizontal ? n.position.x : n.position.y),
    extent: horizontal ? nodeWidth : nodeHeight,
  };
}

function reposition(project: CanvasProjectState, positions: Map<string, { x: number; y: number }>): CanvasProjectState {
  return {
    ...project,
    nodes: project.nodes.map((n) => {
      const position = positions.get(n.id);
      return position ? { ...n, position } : n;
    }),
  };
}

/** Move nodes to new coordinates along one axis, leaving the other untouched. */
function repositionAlongAxis(
  project: CanvasProjectState,
  horizontal: boolean,
  coords: Map<string, number>,
): CanvasProjectState {
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of project.nodes) {
    const coord = coords.get(node.id);
    if (coord === undefined) continue;
    positions.set(node.id, horizontal ? { x: coord, y: node.position.y } : { x: node.position.x, y: coord });
  }
  return reposition(project, positions);
}

// ── Store ────────────────────────────────────────────────────────────

function makeNode(project: CanvasProjectState, projectPath: string, ref: TerminalRef): TerminalCanvasNode {
  const id = nextNodeId(project.nodes, canvasNodeBase(ref.taskId));
  const saved = project.layout[id];
  const parentId = saved?.parentId && project.nodes.some((n) => n.id === saved.parentId) ? saved.parentId : undefined;

  return {
    id,
    type: 'terminal',
    position: saved ? { x: saved.x, y: saved.y } : computeNewNodePosition(project.nodes, project.viewport),
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

  /** Returns whether it wrote — an unknown project, or a change that is a no-op, does not. */
  const update = (projectPath: string, next: (project: CanvasProjectState) => CanvasProjectState): boolean => {
    const project = get().canvasByProject[projectPath];
    if (!project) return false;
    const changed = next(project);
    if (changed === project) return false;
    write(projectPath, changed);
    return true;
  };

  // Edges and selection are rebuilt from the terminal and task stores on every
  // mount, so only the actions that touch what `PersistedCanvas` holds save.
  const updatePersisted = (projectPath: string, next: (project: CanvasProjectState) => CanvasProjectState): void => {
    if (update(projectPath, next)) persistCanvas(projectPath);
  };

  return {
    canvasByProject: {},

    ensureProject: (projectPath) => {
      if (get().canvasByProject[projectPath]) return;
      write(projectPath, emptyProjectState());
    },

    onNodesChange: (projectPath, changes) => {
      const wrote = update(projectPath, (project) => ({
        ...project,
        // A remove change would drop the node without banking its geometry.
        // Removal belongs to reconcileNodes, which does.
        nodes: applyNodeChanges(
          changes.filter((c) => c.type !== 'remove'),
          project.nodes,
        ) as CanvasNode[],
      }));
      // Selection is not in `PersistedCanvas`, so a plain click is not a write.
      if (wrote && changes.some((c) => c.type !== 'select')) persistCanvas(projectPath);
    },

    onEdgesChange: (projectPath, changes) =>
      update(projectPath, (project) => ({ ...project, edges: applyEdgeChanges(changes, project.edges) })),

    reconcileNodes: (projectPath, terminals) => {
      const project = get().canvasByProject[projectPath];
      if (!project) return;

      const live = new Set(terminals.map((t) => t.ptyId));
      const onCanvas = new Set(project.nodes.filter((n) => !isGroupNode(n)).map((n) => n.data.ptyId));
      const gone = project.nodes.filter((n) => !isGroupNode(n) && !live.has(n.data.ptyId));
      const arrived = terminals.filter((t) => !onCanvas.has(t.ptyId));
      if (gone.length === 0 && arrived.length === 0) return;

      const departed = new Map(gone.map((n) => [n.id, n]));
      const layout = { ...project.layout };
      for (const node of gone) layout[node.id] = layoutOf(node);

      // Departures are banked before arrivals are placed, so a terminal that
      // reopens for the same task reclaims the ordinal — and with it the
      // position — the closed one had. A PTY that is re-keyed rather than
      // closed (a loading slot taking on its real id) leaves and arrives in
      // this same pass, so it also reclaims selection, which is not persisted
      // and so cannot come back through `layout`.
      const nodes = project.nodes.filter((n) => !departed.has(n.id));
      for (const ref of arrived) {
        const node = makeNode({ ...project, nodes, layout }, projectPath, ref);
        nodes.push(departed.get(node.id)?.selected ? { ...node, selected: true } : node);
      }

      write(projectPath, {
        ...project,
        // After the arrivals, so a group whose only child was re-keyed still
        // has that child when it is checked for emptiness.
        nodes: pruneEmptyGroups(nodes),
        edges: project.edges.filter((e) => !departed.has(e.source) && !departed.has(e.target)),
        layout,
      });
      persistCanvas(projectPath);
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

    setViewport: (projectPath, viewport) => updatePersisted(projectPath, (project) => ({ ...project, viewport })),

    setNodes: (projectPath, nodes) => updatePersisted(projectPath, (project) => ({ ...project, nodes })),

    setEdges: (projectPath, edges) => update(projectPath, (project) => ({ ...project, edges })),

    setGridSnap: (projectPath, snap) => updatePersisted(projectPath, (project) => ({ ...project, gridSnap: snap })),

    groupSelected: (projectPath) =>
      updatePersisted(projectPath, (project) => {
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
        const groupNode: GroupCanvasNode = {
          id: groupId,
          type: 'group',
          position: { x: bounds.minX - GROUP_PADDING, y: bounds.minY - GROUP_PADDING },
          data: {},
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
      updatePersisted(projectPath, (project) => {
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
      updatePersisted(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 2) return project;

        const horizontal = type === 'left' || type === 'center-h' || type === 'right';
        const { at, extent } = axisOf(horizontal);

        const near = Math.min(...selected.map(at));
        const far = Math.max(...selected.map((n) => at(n) + extent(n)));

        const place = (n: CanvasNode): number => {
          switch (type) {
            case 'left':
            case 'top':
              return near;
            case 'right':
            case 'bottom':
              return far - extent(n);
            default:
              return (near + far) / 2 - extent(n) / 2;
          }
        };

        return repositionAlongAxis(project, horizontal, new Map(selected.map((n) => [n.id, place(n)])));
      }),

    distributeSelected: (projectPath, axis) =>
      updatePersisted(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 3) return project;

        const horizontal = axis === 'horizontal';
        const { at, extent } = axisOf(horizontal);

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

        return repositionAlongAxis(project, horizontal, placed);
      }),

    gridLayoutSelected: (projectPath) =>
      updatePersisted(projectPath, (project) => {
        const selected = project.nodes.filter((n) => n.selected);
        if (selected.length < 2) return project;

        const cols = Math.ceil(Math.sqrt(selected.length));
        const sorted = [...selected].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

        const colWidths: number[] = [];
        const rowHeights: number[] = [];
        const cells = sorted.map((node, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          colWidths[col] = Math.max(colWidths[col] ?? 0, nodeWidth(node));
          rowHeights[row] = Math.max(rowHeights[row] ?? 0, nodeHeight(node));
          return { node, col, row };
        });

        const originX = Math.min(...selected.map((n) => n.position.x));
        const originY = Math.min(...selected.map((n) => n.position.y));

        const placed = new Map<string, { x: number; y: number }>();
        for (const { node, col, row } of cells) {
          placed.set(node.id, {
            x: originX + colWidths.slice(0, col).reduce((s, w) => s + w + GRID_GAP, 0),
            y: originY + rowHeights.slice(0, row).reduce((s, h) => s + h + GRID_GAP, 0),
          });
        }

        return reposition(project, placed);
      }),

    chainLayout: (projectPath, chainMap, nodesByTask) =>
      updatePersisted(projectPath, (project) => {
        const inChain = new Set([...chainMap].filter(([, info]) => isChainMember(info)).map(([taskNum]) => taskNum));
        if (inChain.size === 0) return project;

        const positions = new Map<string, { x: number; y: number }>();

        const childrenOf = (taskNum: number): number[] =>
          chainMap.get(taskNum)?.childTaskNumbers.filter((c) => inChain.has(c)) ?? [];

        const stackedHeight = (nodes: CanvasNode[]): number =>
          nodes.length > 0 ? nodes.reduce((sum, n) => sum + nodeHeight(n) + CHAIN_V_GAP, 0) - CHAIN_V_GAP : 0;

        // The placing pass below needs a child's height before it has placed
        // it, so heights are measured first. Memoised: every parent asks for
        // the same subtree its own parent already asked about.
        const heights = new Map<number, number>();
        const heightOf = (taskNum: number): number => {
          const known = heights.get(taskNum);
          if (known !== undefined) return known;

          const ownHeight = stackedHeight(nodesByTask.get(taskNum) ?? []);
          const children = childrenOf(taskNum);
          const height =
            children.length === 0
              ? ownHeight
              : Math.max(
                  ownHeight,
                  children.reduce((sum, c) => sum + heightOf(c), 0) + (children.length - 1) * CHAIN_V_GAP,
                );

          heights.set(taskNum, height);
          return height;
        };

        /** Places a task's terminals at `x` and its children to the right, centred against it. */
        const layoutSubtree = (taskNum: number, x: number, y: number): void => {
          const nodes = nodesByTask.get(taskNum) ?? [];

          let nodeY = y;
          for (const node of nodes) {
            positions.set(node.id, { x, y: nodeY });
            nodeY += nodeHeight(node) + CHAIN_V_GAP;
          }

          const children = childrenOf(taskNum);
          if (children.length === 0) return;

          const totalChildHeight =
            children.reduce((sum, c) => sum + heightOf(c), 0) + (children.length - 1) * CHAIN_V_GAP;

          const childX = x + (nodes.length > 0 ? Math.max(...nodes.map(nodeWidth)) : 0) + CHAIN_H_GAP;
          let childY = y + stackedHeight(nodes) / 2 - totalChildHeight / 2;
          for (const child of children) {
            layoutSubtree(child, childX, childY);
            childY += heightOf(child) + CHAIN_V_GAP;
          }
        };

        const originX = Math.min(...project.nodes.map((n) => n.position.x));
        let cursorY = Math.min(...project.nodes.map((n) => n.position.y));
        for (const taskNum of inChain) {
          if (chainMap.get(taskNum)?.depth !== 0) continue;
          layoutSubtree(taskNum, originX, cursorY);
          cursorY += heightOf(taskNum) + CHAIN_V_GAP * 2;
        }

        return reposition(project, positions);
      }),

    loadCanvas: (projectPath, persisted) => {
      write(projectPath, {
        nodes: persisted.groups.map((g) => ({
          id: g.id,
          type: 'group' as const,
          position: g.position,
          data: {},
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

/** The terminal the canvas currently has selected, if any. */
export function selectedCanvasPtyId(projectPath: string): string | undefined {
  const project = useCanvasStore.getState().canvasByProject[projectPath];
  return project?.nodes.find((n) => n.selected && !isGroupNode(n))?.data.ptyId;
}

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
      const project = useCanvasStore.getState().canvasByProject[projectPath];
      if (!project) return;

      const payload: PersistedCanvas = {
        version: 2,
        layout: layoutSnapshot(project),
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
