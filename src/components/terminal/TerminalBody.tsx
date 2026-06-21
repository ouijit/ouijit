import { useEffect, useRef, useState } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useShallow } from 'zustand/react/shallow';
import { XTermContainer } from './XTermContainer';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';
import { PlanPanel } from '../plan/PlanPanel';
import { WebPreviewPanel } from '../webPreview/WebPreviewPanel';
import { useTerminalPanels } from './useTerminalPanels';
import { terminalInstances } from './terminalReact';
import type { TerminalPanel } from './panelTypes';

interface TerminalBodyProps {
  ptyId: string;
  projectPath: string;
}

const EMPTY_PANELS: TerminalPanel[] = [];

const XTERM_CLASS =
  'terminal-xterm-container flex-1 min-h-0 min-w-0 rounded-none border-none pt-4 pl-4 pr-2 pb-2 overflow-hidden';

export function TerminalBody({ ptyId, projectPath }: TerminalBodyProps) {
  const { panels, activePanelId, panelFullWidth, diffPanelOpen, diffPanelMode } = useTerminalStore(
    useShallow((s) => {
      const d = s.displayStates[ptyId];
      return {
        panels: d?.panels ?? EMPTY_PANELS,
        activePanelId: d?.activePanelId ?? null,
        panelFullWidth: d?.panelFullWidth ?? true,
        diffPanelOpen: d?.diffPanelOpen ?? false,
        diffPanelMode: d?.diffPanelMode ?? 'uncommitted',
      };
    }),
  );

  const ops = useTerminalPanels(ptyId);

  const activePanel = panels.find((p) => p.id === activePanelId) ?? null;
  const split = !!activePanel && !panelFullWidth;
  const showXterm = !activePanel || split;

  const instance = terminalInstances.get(ptyId);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(instance?.panelSplitRatio ?? 0.5);
  const [dragging, setDragging] = useState(false);

  // Keep the panel area flex-basis in sync with the current layout, and refit
  // both terminals after the layout settles.
  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    requestAnimationFrame(() => {
      inst?.fit();
      const active = inst?.getActivePanel();
      if (active?.kind === 'runner') inst?.runnerChildren.get(active.id)?.fit();
    });
  }, [ptyId, activePanelId, panelFullWidth, split]);

  // Resize-handle drag: adjust the shared split ratio.
  useEffect(() => {
    if (!split) return;
    const handle = handleRef.current;
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!handle || !row || !panel || !instance) return;

    let active = false;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      active = true;
      setDragging(true);
      panel.style.transition = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!active) return;
      const rect = row.getBoundingClientRect();
      const handleWidth = handle.offsetWidth;
      const totalWidth = rect.width - handleWidth;
      const mouseX = e.clientX - rect.left;
      let ratio = 1 - mouseX / totalWidth;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      instance.panelSplitRatio = ratio;
      panel.style.flexBasis = `${ratio * 100}%`;
    };
    const onMouseUp = () => {
      if (!active) return;
      active = false;
      setDragging(false);
      setSplitRatio(instance.panelSplitRatio ?? 0.5);
      panel.style.transition = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      requestAnimationFrame(() => {
        instance.fit();
        const ap = instance.getActivePanel();
        if (ap?.kind === 'runner') instance.runnerChildren.get(ap.id)?.fit();
      });
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [split, instance]);

  const panelStyle: React.CSSProperties = split
    ? { flexBasis: `${splitRatio * 100}%`, minWidth: 200, transition: 'flex-basis 0.25s ease' }
    : { flex: '1 1 0%' };

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={rowRef} className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
        {showXterm && (
          <XTermContainer
            ptyId={ptyId}
            className={XTERM_CLASS}
            style={{
              transition: 'flex 0.25s ease',
              ...(split ? { minWidth: 200 } : {}),
              background: 'var(--color-terminal-bg, #171717)',
            }}
          />
        )}
        {split && (
          <div
            ref={handleRef}
            className="shrink-0 relative hover:bg-white/15 active:bg-white/15 after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-2 after:-right-2"
            style={{ width: 4, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s ease' }}
          />
        )}
        {activePanel && (
          <div
            ref={panelRef}
            className="relative flex flex-col min-h-0 overflow-hidden glass-bevel border border-black/60 rounded-[14px] m-3"
            style={{
              ...panelStyle,
              background: 'var(--color-terminal-bg, #171717)',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 10px rgba(0, 0, 0, 0.18)',
              ...(dragging ? { pointerEvents: 'none' } : {}),
            }}
          >
            <ActivePanel
              ptyId={ptyId}
              panel={activePanel}
              ops={ops}
              fullWidth={panelFullWidth}
              onToggleFullWidth={() => ops.setPanelFullWidth(!panelFullWidth)}
            />
          </div>
        )}
      </div>
      {diffPanelOpen && (
        <DiffPanel
          ptyId={ptyId}
          projectPath={projectPath}
          mode={diffPanelMode}
          onClose={() => terminalInstances.get(ptyId)?.setDiffPanelOpen(false)}
        />
      )}
    </div>
  );
}

function ActivePanel({
  ptyId,
  panel,
  ops,
  fullWidth,
  onToggleFullWidth,
}: {
  ptyId: string;
  panel: TerminalPanel;
  ops: ReturnType<typeof useTerminalPanels>;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
}) {
  switch (panel.kind) {
    case 'runner':
      return (
        <RunnerPanel
          ptyId={ptyId}
          panelId={panel.id}
          onRestart={() => ops.restartRunner(panel.id)}
          fullWidth={fullWidth}
          onToggleFullWidth={onToggleFullWidth}
          onMinimize={() => ops.minimizePanel()}
          onClose={() => ops.closePanel(panel.id)}
        />
      );
    case 'webPreview':
      return (
        <WebPreviewPanel
          ptyId={ptyId}
          panelId={panel.id}
          url={panel.url ?? ''}
          onChangeUrl={(url) => ops.changeWebPreviewUrl(panel.id, url)}
          fullWidth={fullWidth}
          onToggleFullWidth={onToggleFullWidth}
          onMinimize={() => ops.minimizePanel()}
          onClose={() => ops.closePanel(panel.id)}
        />
      );
    case 'plan':
      return (
        <PlanPanel
          ptyId={ptyId}
          panelId={panel.id}
          planPath={panel.planPath}
          onChangePlanFile={(path) => ops.changePlanFile(panel.id, path)}
          fullWidth={fullWidth}
          onToggleFullWidth={onToggleFullWidth}
          onMinimize={() => ops.minimizePanel()}
          onClose={() => ops.closePanel(panel.id)}
        />
      );
  }
}
