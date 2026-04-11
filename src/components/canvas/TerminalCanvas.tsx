import { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  SelectionMode,
  type Viewport,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import {
  useCanvasStore,
  loadPersistedCanvas,
  persistCanvas,
  type TerminalNode as TerminalNodeType,
} from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { TerminalNode } from './TerminalNode';
import { ChainEdge } from './ChainEdge';
import { CanvasControls } from './CanvasControls';
import { SmartGuideOverlay } from './SmartGuideOverlay';
import { AlignMenu } from './AlignMenu';
import { useChainEdges } from './useChainEdges';
import { useSmartGuides } from './useSmartGuides';
import { getChainColor, buildChainMap } from '../../utils/taskChain';
import { useProjectStore } from '../../stores/projectStore';

/**
 * Reconcile canvas nodes with the terminal store — add missing, remove stale.
 * Treats missing terminal list as empty (all canvas nodes are stale).
 */
export function syncCanvasWithTerminals(projectPath: string): void {
  const terminalPtyIds = useTerminalStore.getState().terminalsByProject[projectPath] ?? [];
  const canvasState = useCanvasStore.getState().canvasByProject[projectPath];
  if (!canvasState) return;

  const terminalSet = new Set(terminalPtyIds);
  const store = useCanvasStore.getState();

  // Add canvas nodes for terminals that don't have one yet
  const canvasNodeIds = new Set(canvasState.nodes.map((n) => n.id));
  for (const ptyId of terminalPtyIds) {
    if (!canvasNodeIds.has(ptyId)) {
      store.addNode(projectPath, ptyId);
    }
  }

  // Remove canvas nodes whose terminal no longer exists
  let changed = false;
  for (const node of canvasState.nodes) {
    if (node.type === 'terminal' && !node.id.startsWith('group-') && !terminalSet.has(node.id)) {
      store.removeNode(projectPath, node.id);
      changed = true;
    }
  }
  if (changed) {
    persistCanvas(projectPath);
  }
}

// Defined outside component to prevent re-renders
const nodeTypes = { terminal: TerminalNode };
const edgeTypes = { chain: ChainEdge };
const snapGrid: [number, number] = [20, 20];
const proOptions = { hideAttribution: true };

const EMPTY_NODES: TerminalNodeType[] = [];
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

  // Phase 2: chain edges
  useChainEdges(projectPath);

  // Phase 3: smart guides
  const { guides, onNodeDrag, onNodeDragStop } = useSmartGuides(nodes);

  // Minimap toggle
  const [minimapOpen, setMinimapOpen] = useState(true);
  const handleToggleMinimap = useCallback(() => setMinimapOpen((v) => !v), []);

  // Phase 3: align/distribute context menu
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const handleSelectionContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  }, []);
  const handleCloseMenu = useCallback(() => setMenuPos(null), []);

  // Phase 3: minimap node color from chain info
  const tasks = useProjectStore((s) => s.tasks);
  const displayStates = useTerminalStore((s) => s.displayStates);
  const minimapNodeColor = useCallback(
    (node: TerminalNodeType) => {
      const ptyId = node.data?.ptyId;
      if (!ptyId) return 'rgba(255, 255, 255, 0.15)';
      const display = displayStates[ptyId];
      if (!display?.taskId) return 'rgba(255, 255, 255, 0.15)';
      const chainMap = buildChainMap(tasks);
      const info = chainMap.get(display.taskId);
      if (!info) return 'rgba(255, 255, 255, 0.15)';
      return getChainColor(info.rootTaskNumber, info.depth);
    },
    [tasks, displayStates],
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

  const onNodesChange = useCallback(
    (changes: NodeChange<TerminalNodeType>[]) => {
      useCanvasStore.getState().onNodesChange(projectPath, changes);
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      useCanvasStore.getState().onEdgesChange(projectPath, changes);
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  const onViewportChange = useCallback(
    (vp: Viewport) => {
      useCanvasStore.getState().setViewport(projectPath, vp);
      persistCanvas(projectPath);
    },
    [projectPath],
  );

  // Only pass viewport/onViewportChange when we have loaded state
  const viewportProps = viewport
    ? { viewport, onViewportChange }
    : { defaultViewport: { x: 0, y: 0, zoom: 1 } as Viewport };

  return (
    <div className="terminal-canvas w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        {...viewportProps}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onSelectionContextMenu={handleSelectionContextMenu}
        panOnScroll
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
        colorMode="dark"
        fitView
        proOptions={proOptions}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.15)" />
        <CanvasControls projectPath={projectPath} />
        {nodes.length >= 3 &&
          (minimapOpen ? (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              nodeColor={minimapNodeColor as (node: any) => string}
              maskColor="rgba(0, 0, 0, 0.25)"
              bgColor="#1c1c1e"
              nodeBorderRadius={16}
              onClick={handleToggleMinimap}
            />
          ) : (
            <Panel position="bottom-right">
              <button
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 text-white/40 hover:text-white/70 transition-colors duration-150"
                style={{ background: 'rgba(28, 28, 30, 0.8)', backdropFilter: 'blur(12px)' }}
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
      </ReactFlow>
      <SmartGuideOverlay guides={guides} />
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
