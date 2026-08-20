import { memo, useCallback } from 'react';
import { useCanvasStore, type AlignType, type DistributeAxis } from '../../stores/canvasStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { nodesByTask } from '../../stores/canvasSync';
import { useProjectStore } from '../../stores/projectStore';
import { buildChainMap } from '../../utils/taskChain';
import { ContextMenu, type ContextMenuEntry } from '../ui/ContextMenu';

interface AlignMenuProps {
  projectPath: string;
  position: { x: number; y: number } | null;
  onClose: () => void;
}

/** Context menu for aligning and distributing selected nodes. */
export const AlignMenu = memo(function AlignMenu({ projectPath, position, onClose }: AlignMenuProps) {
  const tasks = useProjectStore((s) => s.tasks);
  const displayStates = useTerminalStore((s) => s.displayStates);

  const handleChainLayout = useCallback(() => {
    const canvas = useCanvasStore.getState().canvasByProject[projectPath];
    if (!canvas) return;
    useCanvasStore
      .getState()
      .chainLayout(projectPath, buildChainMap(tasks), nodesByTask(canvas.nodes, displayStates));
  }, [projectPath, tasks, displayStates]);

  const canvasNodes = useCanvasStore((s) => s.canvasByProject[projectPath]?.nodes);
  const selectedCount = canvasNodes?.filter((n) => n.selected).length ?? 0;

  if (!position || selectedCount < 2) return null;

  const align = (type: AlignType) => () => useCanvasStore.getState().alignSelected(projectPath, type);
  const distribute = (axis: DistributeAxis) => () => useCanvasStore.getState().distributeSelected(projectPath, axis);

  const items: ContextMenuEntry[] = [
    { label: 'Align Left', icon: 'align-left', onClick: align('left') },
    { label: 'Align Center', icon: 'align-center-horizontal', onClick: align('center-h') },
    { label: 'Align Right', icon: 'align-right', onClick: align('right') },
    { separator: true },
    { label: 'Align Top', icon: 'align-top', onClick: align('top') },
    { label: 'Align Middle', icon: 'align-center-vertical', onClick: align('center-v') },
    { label: 'Align Bottom', icon: 'align-bottom', onClick: align('bottom') },
  ];

  if (selectedCount >= 3) {
    items.push(
      { separator: true },
      {
        label: 'Distribute Horizontal',
        icon: 'arrows-out-line-horizontal',
        onClick: distribute('horizontal'),
      },
      { label: 'Distribute Vertical', icon: 'arrows-out-line-vertical', onClick: distribute('vertical') },
    );
  }

  items.push(
    { separator: true },
    {
      label: 'Grid Layout',
      icon: 'grid-four',
      onClick: () => useCanvasStore.getState().gridLayoutSelected(projectPath),
    },
    { label: 'Chain Tree Layout', icon: 'tree-structure', onClick: handleChainLayout },
  );

  return <ContextMenu x={position.x} y={position.y} items={items} onClose={onClose} />;
});
