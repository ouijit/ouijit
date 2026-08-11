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
  // The diff takes the panel slot while it is open rather than covering the
  // body: it is a view of the same work as everything else that opens beside a
  // terminal, and it was the one that could not be dragged narrower to keep an
  // eye on what the agent was doing while reading what it had done. It is not
  // one of the tabs — nobody opens two — so it borrows the slot instead of
  // joining the list, and the tab underneath is still there when it closes.
  const slotOpen = diffPanelOpen || !!activePanel;
  const split = slotOpen && !panelFullWidth;

  const instance = terminalInstances.get(ptyId);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(instance?.panelSplitRatio ?? 0.5);
  const [dragging, setDragging] = useState(false);

  // Only animate the width when the SAME panel toggles between full-width and
  // split. Opening, switching, or closing a panel changes what is in the slot
  // and should snap instantly — otherwise the panel appears to grow from the
  // right. The diff is one more thing the slot can hold, so it counts here.
  const slotKey = diffPanelOpen ? 'diff' : activePanelId;
  const prevSlotKey = useRef(slotKey);
  const animate = prevSlotKey.current === slotKey;
  useEffect(() => {
    prevSlotKey.current = slotKey;
  });

  // Keep the panel area in sync with the current layout, and refit both
  // terminals after the layout settles.
  useEffect(() => {
    const inst = terminalInstances.get(ptyId);
    requestAnimationFrame(() => {
      inst?.fit();
      const active = inst?.getActivePanel();
      if (active?.kind === 'runner') inst?.runnerChildren.get(active.id)?.fit();
    });
  }, [ptyId, activePanelId, diffPanelOpen, panelFullWidth, split]);

  // Resize-handle drag: adjust the shared split ratio.
  useEffect(() => {
    if (!split) return;
    const handle = handleRef.current;
    const row = rowRef.current;
    const panel = panelRef.current;
    if (!handle || !row || !panel || !instance) return;

    let active = false;
    const xtermEl = row.querySelector<HTMLElement>('.terminal-xterm-container');

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      active = true;
      setDragging(true);
      panel.style.transition = 'none';
      if (xtermEl) xtermEl.style.transition = 'none';
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
      if (xtermEl) xtermEl.style.flexBasis = `${(1 - ratio) * 100}%`;
    };
    const onMouseUp = () => {
      if (!active) return;
      active = false;
      setDragging(false);
      setSplitRatio(instance.panelSplitRatio ?? 0.5);
      panel.style.transition = '';
      if (xtermEl) xtermEl.style.transition = '';
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

  // Width is driven by flex-basis with flex-grow held constant at 0, so toggling
  // between full-width and split animates ONLY the basis (the property that
  // reliably transitions). Swapping grow would make the panel collapse and grow
  // back from the right. flex-shrink lets basis:100% fit without margin overflow.
  // The xterm stays mounted at basis 0 when hidden so the toggle has a frame to
  // animate from. When there is no panel at all, the xterm grows to fill.
  const xtermBasis = !slotOpen || !split ? '0%' : `${(1 - splitRatio) * 100}%`;
  const panelBasis = split ? `${splitRatio * 100}%` : '100%';
  const transition = animate ? 'flex-basis 0.25s ease' : 'none';

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={rowRef} className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
        <XTermContainer
          ptyId={ptyId}
          className={XTERM_CLASS}
          style={{
            flexGrow: slotOpen ? 0 : 1,
            flexShrink: 1,
            flexBasis: xtermBasis,
            transition,
            // Collapse padding too when hidden, so basis 0 means truly zero width.
            ...(slotOpen && !split ? { padding: 0 } : {}),
            background: 'var(--color-terminal-bg)',
          }}
        />
        {split && (
          <div
            ref={handleRef}
            className="shrink-0 relative hover:bg-ink/15 active:bg-ink/15 after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-2 after:-right-2"
            style={{ width: 4, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s ease' }}
          />
        )}
        {slotOpen && (
          <div
            ref={panelRef}
            className="relative flex flex-col min-h-0 overflow-hidden glass-bevel border border-bezel-panel rounded-[14px] m-3"
            style={{
              flexGrow: 0,
              flexShrink: 1,
              flexBasis: panelBasis,
              transition,
              background: 'var(--color-terminal-bg)',
              boxShadow: 'var(--shadow-inset-panel)',
              ...(dragging ? { pointerEvents: 'none' } : {}),
            }}
          >
            {diffPanelOpen ? (
              <DiffPanel
                ptyId={ptyId}
                projectPath={projectPath}
                mode={diffPanelMode}
                fullWidth={panelFullWidth}
                onToggleFullWidth={() => ops.setPanelFullWidth(!panelFullWidth)}
                onClose={() => terminalInstances.get(ptyId)?.setDiffPanelOpen(false)}
              />
            ) : (
              activePanel && (
                <ActivePanel
                  ptyId={ptyId}
                  panel={activePanel}
                  ops={ops}
                  fullWidth={panelFullWidth}
                  onToggleFullWidth={() => ops.setPanelFullWidth(!panelFullWidth)}
                />
              )
            )}
          </div>
        )}
      </div>
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
          onKill={() => ops.killRunner(panel.id)}
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
