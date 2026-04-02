import { useRef, useCallback, useEffect, useState } from 'react';
import { terminalInstances } from './terminalReact';
import { XTermContainer } from './XTermContainer';
import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';

interface RunnerPanelProps {
  ptyId: string;
  onCollapse: () => void;
  onKill: () => void;
  onRestart: () => void;
}

export function RunnerPanel({ ptyId, onCollapse, onKill, onRestart }: RunnerPanelProps) {
  const instance = terminalInstances.get(ptyId);
  const runner = instance?.runner;

  const [fullWidth, setFullWidth] = useState(instance?.runnerFullWidth ?? true);
  const [splitRatio, setSplitRatio] = useState(instance?.runnerSplitRatio ?? 0.5);

  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const runnerPtyId = runner?.ptyId;
  const panelTitle = instance?.runnerCommand || 'Runner';

  // Toggle full-width vs split
  const toggleFullWidth = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!instance) return;
      const newFullWidth = !fullWidth;
      instance.runnerFullWidth = newFullWidth;
      setFullWidth(newFullWidth);
      instance.pushDisplayState({ runnerFullWidth: newFullWidth });

      requestAnimationFrame(() => {
        instance.fit();
        runner?.fit();
      });
    },
    [fullWidth, instance, runner],
  );

  // Resize handle drag
  useEffect(() => {
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel || !instance) return;

    const cardBody = panel.parentElement;
    if (!cardBody) return;

    let dragging = false;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      panel.style.transition = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = cardBody.getBoundingClientRect();
      const handleWidth = handle.offsetWidth;
      const totalWidth = rect.width - handleWidth;
      const mouseX = e.clientX - rect.left;
      let ratio = 1 - mouseX / totalWidth;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      instance.runnerSplitRatio = ratio;
      setSplitRatio(ratio);
      panel.style.flexBasis = `${ratio * 100}%`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [instance, fullWidth]);

  // Set initial flex-basis
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (fullWidth) {
      panel.style.flexBasis = '100%';
    } else {
      panel.style.flexBasis = `${splitRatio * 100}%`;
    }

    // Fit terminals after layout
    requestAnimationFrame(() => {
      runner?.fit();
      if (!fullWidth) {
        instance?.fit();
      }
    });
  }, [fullWidth, splitRatio, runner, instance]);

  if (!runnerPtyId) return null;

  const splitIcon = fullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal';
  const splitTitle = fullWidth ? 'Split view' : 'Full width';

  return (
    <>
      {!fullWidth && (
        <div
          ref={handleRef}
          className="shrink-0 relative hover:bg-white/15 active:bg-white/15 after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-2 after:-right-2"
          style={{ width: 4, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s ease' }}
        />
      )}
      <div
        ref={panelRef}
        className="rounded-none border-0 border-l border-t border-solid border-white/10 shadow-none flex flex-col overflow-hidden"
        style={{
          flexBasis: 0,
          background: 'var(--color-terminal-bg, #171717)',
          transition: 'flex-basis 0.25s ease',
          ...(fullWidth ? { flex: '1 0 100%', borderLeft: 'none' } : { minWidth: 200 }),
        }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
          <span className="text-[13px] text-white/50 truncate flex-1 font-mono">{panelTitle}</span>
          <Tooltip text="Kill">
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/40 shrink-0 transition-all duration-150 ease-out hover:bg-red-500/20 hover:text-[#ff6b6b] [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onKill();
              }}
            >
              <Icon name="prohibit" />
            </button>
          </Tooltip>
          <Tooltip text="Restart">
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/40 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={(e) => {
                e.stopPropagation();
                onRestart();
              }}
            >
              <Icon name="arrow-counter-clockwise" />
            </button>
          </Tooltip>
          <Tooltip text={splitTitle}>
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
              onClick={toggleFullWidth}
            >
              <Icon name={splitIcon} />
            </button>
          </Tooltip>
          <Tooltip text="Minimize">
            <button
              className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-4 [&>svg]:h-4"
              onClick={(e) => {
                e.stopPropagation();
                onCollapse();
              }}
            >
              <Icon name="minus" />
            </button>
          </Tooltip>
        </div>
        <div className="flex-1 overflow-hidden min-h-0 p-4">
          <XTermContainer ptyId={runnerPtyId} className="runner-xterm-container w-full h-full overflow-hidden" />
        </div>
      </div>
    </>
  );
}
