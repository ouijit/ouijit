import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  SelectionMode,
  useReactFlow,
  type Viewport,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import {
  useCanvasStore,
  isGroupNode,
  loadPersistedCanvas,
  type CanvasNode as CanvasNodeType,
} from '../../stores/canvasStore';
import { syncCanvasWithTerminals } from '../../stores/canvasSync';
import { useTerminalStore, terminalMatchesTag } from '../../stores/terminalStore';
import { TerminalNode, GroupNode } from './TerminalNode';
import { terminalInstances } from '../terminal/terminalReact';
import { ChainEdge } from './ChainEdge';
import { CanvasControls } from './CanvasControls';
import { SmartGuideOverlay } from './SmartGuideOverlay';
import { AlignMenu } from './AlignMenu';
import { useChainEdges } from './useChainEdges';
import { useSmartGuides } from './useSmartGuides';
import { getChainColor, buildChainMap } from '../../utils/taskChain';
import { useProjectStore } from '../../stores/projectStore';
import { readToken } from '../../theme/themeManager';
import { useResolvedTheme, useThemeEpoch } from '../../hooks/useResolvedTheme';

// Defined outside component to prevent re-renders
const nodeTypes = { terminal: TerminalNode, group: GroupNode };
const edgeTypes = { chain: ChainEdge };
const snapGrid: [number, number] = [20, 20];
const proOptions = { hideAttribution: true };

const EMPTY_NODES: CanvasNodeType[] = [];
const EMPTY_EDGES: import('@xyflow/react').Edge[] = [];

interface TerminalCanvasProps {
  projectPath: string;
}

function TerminalCanvasInner({ projectPath }: TerminalCanvasProps) {
  const project = useCanvasStore((s) => s.canvasByProject[projectPath]);
  const nodes = project?.nodes ?? EMPTY_NODES;
  const edges = project?.edges ?? EMPTY_EDGES;
  const viewport = project?.viewport;
  const gridSnap = project?.gridSnap ?? false;

  // Tag filter: hide non-matching nodes (and their edges) rather than removing
  // them, so persisted canvas positions survive filtering.
  const displayStates = useTerminalStore((s) => s.displayStates);
  const tagFilter = useProjectStore((s) => s.tagFilter);
  const hiddenIds = useMemo(() => {
    if (!tagFilter) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (isGroupNode(n)) continue;
      if (!terminalMatchesTag(displayStates[n.data.ptyId], tagFilter)) set.add(n.id);
    }
    return set;
  }, [nodes, tagFilter, displayStates]);
  const renderedNodes = useMemo(
    () => (hiddenIds ? nodes.map((n) => (hiddenIds.has(n.id) ? { ...n, hidden: true } : n)) : nodes),
    [nodes, hiddenIds],
  );
  const renderedEdges = useMemo(
    () =>
      hiddenIds && hiddenIds.size > 0
        ? edges.filter((e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target))
        : edges,
    [edges, hiddenIds],
  );

  // Built once here and handed to both consumers: React Flow calls nodeColor
  // per node on every minimap render, and the edge effect re-runs on each drag
  // frame, so neither can afford to rebuild it.
  const tasks = useProjectStore((s) => s.tasks);
  const chainMap = useMemo(() => buildChainMap(tasks), [tasks]);

  useChainEdges(projectPath, chainMap);

  const { guides, onNodeDrag, onNodeDragStop } = useSmartGuides(nodes);

  // Shift drives `.canvas-selecting` (see index.css). Written to the DOM rather
  // than held in React state: every shifted keystroke typed into a terminal
  // fires this, and none of them concern the canvas tree. `pointer-events` is
  // inherited, so each write invalidates the style of every xterm row under
  // every node — hence the latch, which writes only on a transition.
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let held = false;
    const set = (shift: boolean) => {
      if (shift === held) return;
      held = shift;
      surfaceRef.current?.classList.toggle('canvas-selecting', shift);
    };
    const sync = (e: KeyboardEvent) => set(e.shiftKey);
    const clear = () => set(false);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // Minimap toggle
  const [minimapOpen, setMinimapOpen] = useState(true);
  const handleToggleMinimap = useCallback(() => setMinimapOpen((v) => !v), []);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const handleSelectionContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  }, []);
  const handleCloseMenu = useCallback(() => setMenuPos(null), []);
  const handlePaneClick = useCallback(() => setMenuPos(null), []);

  // Double-click a node to frame it and focus its terminal
  const { fitView } = useReactFlow();
  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: CanvasNodeType) => {
      setMenuPos(null);
      const ptyId = isGroupNode(node) ? null : node.data.ptyId;
      if (ptyId && useTerminalStore.getState().displayStates[ptyId]?.isLoading) return;
      fitView({ nodes: [{ id: node.id }], padding: 0.1, duration: 350 });
      const instance = ptyId ? terminalInstances.get(ptyId) : undefined;
      if (instance) requestAnimationFrame(() => instance.xterm.focus());
    },
    [fitView],
  );

  // MiniMap colors land in SVG fill attributes where var() can't resolve, so
  // read the tokens per applied theme (the epoch also covers switches between
  // two themes with the same base, which the resolved base can't see).
  const themeEpoch = useThemeEpoch();
  const colorMode = useResolvedTheme();
  const [minimapFallbackColor, minimapBgColor, minimapMaskColor] = useMemo(() => {
    void themeEpoch; // the tokens change when the applied theme does
    return [readToken('--color-border-hover'), readToken('--color-background'), readToken('--color-minimap-mask')];
  }, [themeEpoch]);
  const minimapNodeColor = useCallback(
    (node: CanvasNodeType) => {
      const display = isGroupNode(node) ? undefined : displayStates[node.data.ptyId];
      if (!display?.taskId) return minimapFallbackColor;
      const info = chainMap.get(display.taskId);
      if (!info) return minimapFallbackColor;
      return getChainColor(info.rootTaskNumber, info.depth);
    },
    [chainMap, displayStates, minimapFallbackColor],
  );

  // Load persisted canvas state on mount, then reconcile with current terminals
  useEffect(() => {
    useCanvasStore.getState().ensureProject(projectPath);
    loadPersistedCanvas(projectPath).then((saved) => {
      if (saved) {
        useCanvasStore.getState().loadCanvas(projectPath, saved);
      }
      // Always sync after load to add terminals that exist but aren't in the saved state
      syncCanvasWithTerminals(projectPath);
    });
  }, [projectPath]);

  // Terminals also arrive while the canvas is already mounted — starting a task
  // from the board stages a loading slot well before its PTY exists.
  useEffect(() => {
    return useTerminalStore.subscribe((state, prev) => {
      if (state.terminalsByProject[projectPath] === prev.terminalsByProject[projectPath]) return;
      syncCanvasWithTerminals(projectPath);
    });
  }, [projectPath]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNodeType>[]) => {
      useCanvasStore.getState().onNodesChange(projectPath, changes);
    },
    [projectPath],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      useCanvasStore.getState().onEdgesChange(projectPath, changes);
    },
    [projectPath],
  );

  const onViewportChange = useCallback(
    (vp: Viewport) => {
      useCanvasStore.getState().setViewport(projectPath, vp);
    },
    [projectPath],
  );

  // Only pass viewport/onViewportChange when we have loaded state
  const viewportProps = viewport
    ? { viewport, onViewportChange }
    : { defaultViewport: { x: 0, y: 0, zoom: 1 } as Viewport };

  return (
    <div ref={surfaceRef} className="terminal-canvas relative w-full h-full">
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        {...viewportProps}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={handleSelectionContextMenu}
        onPaneClick={handlePaneClick}
        onNodeClick={handlePaneClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        panOnScroll
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch
        panActivationKeyCode="Space"
        zoomActivationKeyCode="Meta"
        minZoom={0.05}
        maxZoom={2}
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Meta"
        selectionMode={SelectionMode.Partial}
        snapToGrid={gridSnap}
        snapGrid={snapGrid}
        deleteKeyCode={null}
        disableKeyboardA11y
        colorMode={colorMode}
        fitView
        proOptions={proOptions}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        {nodes.length >= 3 &&
          (minimapOpen ? (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={minimapNodeColor as (node: any) => string}
              maskColor={minimapMaskColor}
              bgColor={minimapBgColor}
              nodeBorderRadius={16}
              onClick={handleToggleMinimap}
            />
          ) : (
            <Panel position="bottom-right">
              <button
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-ink/10 text-ink/40 hover:text-ink/70 transition-colors duration-150"
                style={{
                  background: 'color-mix(in srgb, var(--color-background) 80%, transparent)',
                  backdropFilter: 'blur(12px)',
                }}
                onClick={handleToggleMinimap}
                title="Show minimap"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <rect x="12" y="12" width="9" height="9" rx="1" />
                </svg>
              </button>
            </Panel>
          ))}
        <SmartGuideOverlay guides={guides} />
      </ReactFlow>
      <CanvasControls projectPath={projectPath} />
      <AlignMenu projectPath={projectPath} position={menuPos} onClose={handleCloseMenu} />
    </div>
  );
}

export function TerminalCanvas({ projectPath }: TerminalCanvasProps) {
  return (
    <ReactFlowProvider>
      <TerminalCanvasInner projectPath={projectPath} />
    </ReactFlowProvider>
  );
}
