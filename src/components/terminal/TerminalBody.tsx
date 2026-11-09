import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useChatStore } from '../../stores/chatStore';
import { useShallow } from 'zustand/react/shallow';
import { XTermContainer } from './XTermContainer';
import { ChatView } from '../chat/ChatView';
import { SurfaceToggle } from '../chat/SurfaceToggle';
import { RunnerPanel } from './RunnerPanel';
import { DiffPanel } from '../diff/DiffPanel';
import { PlanPanel } from '../plan/PlanPanel';
import { WebPreviewPanel } from '../webPreview/WebPreviewPanel';
import { useTerminalPanels } from './useTerminalPanels';
import { terminalInstances } from './terminalRegistry';
import type { TerminalPanel } from './panelTypes';
import type { TaskSurface } from '../../chat/preferences';

interface TerminalBodyProps {
  ptyId: string;
  projectPath: string;
}

const EMPTY_PANELS: TerminalPanel[] = [];

const XTERM_CLASS =
  'terminal-xterm-container flex-1 min-h-0 min-w-0 rounded-none border-none pt-4 pl-4 pr-2 pb-2 overflow-hidden';

const FADE_MS = 240;
/** How long the view being left stays up when the one replacing it never reports in. */
const FADE_DEADLINE_MS = 8000;

/**
 * Whether the view the card is switching to has something to show: a chat
 * once its session is adopted with a transcript or a settled status, a
 * terminal once its PTY has drawn. A chat left over from an earlier switch has
 * already exited, so it does not count.
 */
function useSurfaceReady(ptyId: string, surface: TaskSurface): boolean {
  const chatReady = useChatStore((s) => {
    const session = s.sessions[ptyId];
    if (!session || session.info.status === 'exited') return false;
    return session.nodes.length > 0 || session.info.status !== 'starting';
  });
  const painted = useTerminalStore((s) => !(s.displayStates[ptyId]?.blank ?? false));
  return surface === 'chat' ? chatReady : painted;
}

/**
 * Switching surface keeps the view being left in place until the one replacing
 * it is ready, then fades that one in over it and drops the old one once the
 * fade has ended. Both views keep their own slot so a change of role never
 * remounts either of them, and the leaving one is known in the same render
 * that drops it from current, so it never leaves the tree in between.
 */
function useSurfaceSwap(
  ptyId: string,
  surface: TaskSurface,
): { outgoing: TaskSurface | null; revealed: boolean; onFaded: () => void } {
  const [outgoing, setOutgoing] = useState<TaskSurface | null>(null);
  const [shown, setShown] = useState(surface);
  if (shown !== surface) {
    setShown(surface);
    setOutgoing(shown);
  }

  const ready = useSurfaceReady(ptyId, surface);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!outgoing) {
      setRevealed(false);
      return;
    }
    if (ready) {
      setRevealed(true);
      return;
    }
    const deadline = setTimeout(() => setRevealed(true), FADE_DEADLINE_MS);
    return () => clearTimeout(deadline);
  }, [outgoing, ready]);
  const onFaded = useCallback(() => setOutgoing(null), []);
  // Should the transition never fire, as when the card is off screen.
  useEffect(() => {
    if (!revealed) return;
    const fallback = setTimeout(onFaded, FADE_MS * 2);
    return () => clearTimeout(fallback);
  }, [revealed, onFaded]);

  return { outgoing, revealed, onFaded };
}

export function TerminalBody({ ptyId, projectPath }: TerminalBodyProps) {
  const { panels, activePanelId, panelFullWidth, diffPanelOpen, surface, hasChat } = useTerminalStore(
    useShallow((s) => {
      const d = s.displayStates[ptyId];
      return {
        surface: d?.surface ?? 'terminal',
        hasChat: (d?.chatAgent ?? null) !== null,
        panels: d?.panels ?? EMPTY_PANELS,
        activePanelId: d?.activePanelId ?? null,
        panelFullWidth: d?.panelFullWidth ?? true,
        diffPanelOpen: d?.diffPanelOpen ?? false,
      };
    }),
  );

  const ops = useTerminalPanels(ptyId);
  const { outgoing, revealed, onFaded } = useSurfaceSwap(ptyId, surface);

  const activePanel = panels.find((p) => p.id === activePanelId) ?? null;
  // The diff takes the panel slot while it is open rather than covering the
  // body, so it can be dragged narrower to watch the terminal alongside it. It
  // borrows the slot instead of joining the tabs, so the tab underneath
  // survives it closing.
  //
  // Keyed on the resolved panel rather than the id: an id pointing at a panel
  // that has gone counts as an empty slot.
  const slotKey = diffPanelOpen ? 'diff' : (activePanel?.id ?? null);
  const slotOpen = slotKey !== null;
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
  const prevSlotKey = useRef(slotKey);
  const animate = prevSlotKey.current === slotKey;
  useEffect(() => {
    prevSlotKey.current = slotKey;
  });

  // Before the layout changes, so no resize lands while the panel covers it.
  useLayoutEffect(() => {
    const inst = terminalInstances.get(ptyId);
    if (inst) inst.covered = slotOpen && !split;
  }, [ptyId, slotOpen, split]);

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
    const xtermEl = row.querySelector<HTMLElement>('[data-card-main]');

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
  const xtermBasis = !split ? '0%' : `${(1 - splitRatio) * 100}%`;
  const panelBasis = split ? `${splitRatio * 100}%` : '100%';
  const transition = animate ? 'flex-basis 0.25s ease' : 'none';

  return (
    <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={rowRef} className="relative flex-1 flex flex-row min-h-0 overflow-hidden">
        <div
          data-card-main
          className="relative flex flex-col min-h-0 min-w-0 overflow-hidden"
          style={{
            flexGrow: slotOpen ? 0 : 1,
            flexShrink: 1,
            flexBasis: xtermBasis,
            transition,
            background: 'var(--color-terminal-bg)',
          }}
        >
          <SurfaceToggle ptyId={ptyId} />
          {(surface === 'terminal' || outgoing === 'terminal') && (
            <SurfaceLayer
              role={surface === 'terminal' ? (outgoing && !revealed ? 'pending' : 'current') : 'leaving'}
              fading={surface === 'terminal' && outgoing !== null}
              onFaded={onFaded}
            >
              <XTermContainer
                ptyId={ptyId}
                className={XTERM_CLASS}
                // Collapse padding too when hidden, so basis 0 means truly zero width.
                style={{
                  background: 'var(--color-terminal-bg)',
                  // Room for the chat/terminal switch floating in the corner.
                  ...(hasChat ? { paddingTop: 48 } : {}),
                  ...(slotOpen && !split ? { padding: 0 } : {}),
                }}
              />
            </SurfaceLayer>
          )}
          {(surface === 'chat' || outgoing === 'chat') && (
            <SurfaceLayer
              role={surface === 'chat' ? (outgoing && !revealed ? 'pending' : 'current') : 'leaving'}
              fading={surface === 'chat' && outgoing !== null}
              onFaded={onFaded}
            >
              <ChatView cardId={ptyId} />
            </SurfaceLayer>
          )}
        </div>
        {/* One pixel of cut, with a grab target either side of it — see
            `.pane-seam`. The target is lifted but the cut is not: the panel
            is flush and positioned, so it would otherwise take the half of
            the target that overlaps it. */}
        {split && (
          <div
            ref={handleRef}
            className="pane-seam relative w-px shrink-0 after:content-[''] after:absolute after:z-[1] after:top-0 after:bottom-0 after:-left-2 after:-right-2"
            style={{ cursor: 'col-resize' }}
          />
        )}
        {slotOpen && (
          // Flush to the card it opens in: the card's own rounding clips the
          // outer corners.
          <div
            ref={panelRef}
            className="relative flex flex-col min-h-0 overflow-hidden"
            style={{
              flexGrow: 0,
              flexShrink: 1,
              flexBasis: panelBasis,
              transition,
              background: 'var(--color-terminal-bg)',
              ...(dragging ? { pointerEvents: 'none' } : {}),
            }}
          >
            {diffPanelOpen ? (
              <DiffPanel
                ptyId={ptyId}
                projectPath={projectPath}
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

/**
 * The view that is current fills the body; one that is leaving sits under it
 * at full size; one still pending is in place but see-through, so the leaving
 * view shows until the pending one fades in over it. Only the view coming in
 * moves: the one underneath is covered by the time the fade ends, so fading it
 * too would only let the background show through midway.
 */
function SurfaceLayer({
  role,
  fading,
  onFaded,
  children,
}: {
  role: 'current' | 'pending' | 'leaving';
  /** Coming in over another view, so a finished opacity transition ends the swap. */
  fading: boolean;
  onFaded: () => void;
  children: React.ReactNode;
}) {
  const leaving = role === 'leaving';
  return (
    <div
      className={
        leaving
          ? 'absolute inset-0 flex flex-col min-h-0 min-w-0'
          : 'relative z-[1] flex-1 flex flex-col min-h-0 min-w-0'
      }
      style={{
        opacity: role === 'pending' ? 0 : 1,
        transition: fading ? `opacity ${FADE_MS}ms cubic-bezier(0.2, 0, 0, 1)` : undefined,
        willChange: fading ? 'opacity' : undefined,
        pointerEvents: role === 'current' ? undefined : 'none',
        background: 'var(--color-terminal-bg)',
      }}
      onTransitionEnd={(event) => {
        if (fading && event.target === event.currentTarget && event.propertyName === 'opacity') onFaded();
      }}
    >
      {children}
    </div>
  );
}
