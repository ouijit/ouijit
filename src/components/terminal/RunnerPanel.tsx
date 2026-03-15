import { useRef, useCallback, useEffect, useState } from 'react';
import { terminalInstances } from './terminalReact';
import { XTermContainer } from './XTermContainer';
import { Icon } from './Icon';

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

      if (!newFullWidth) {
        // When going to split, ensure both terminals refit
        requestAnimationFrame(() => {
          instance.fit();
          runner?.fit();
        });
      } else {
        requestAnimationFrame(() => {
          runner?.fit();
        });
      }
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
  }, [instance]);

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

  const splitIcon = fullWidth ? 'split-horizontal' : 'arrows-out';
  const splitTitle = fullWidth ? 'Split view' : 'Full width';

  return (
    <>
      {!fullWidth && <div ref={handleRef} className="runner-resize-handle" />}
      <div ref={panelRef} className={`runner-panel runner-panel--visible${fullWidth ? ' runner-panel--full' : ''}`}>
        <div className="runner-panel-header">
          <span className="runner-panel-title">{panelTitle}</span>
          <button
            className="runner-panel-kill"
            title="Kill"
            onClick={(e) => {
              e.stopPropagation();
              onKill();
            }}
          >
            <Icon name="prohibit" />
          </button>
          <button
            className="runner-panel-restart"
            title="Restart"
            onClick={(e) => {
              e.stopPropagation();
              onRestart();
            }}
          >
            <Icon name="arrow-counter-clockwise" />
          </button>
          <button className="runner-panel-split-toggle" title={splitTitle} onClick={toggleFullWidth}>
            <Icon name={splitIcon} />
          </button>
          <button
            className="runner-panel-collapse"
            title="Minimize panel"
            onClick={(e) => {
              e.stopPropagation();
              onCollapse();
            }}
          >
            <Icon name="minus" />
          </button>
        </div>
        <div className="runner-panel-body">
          <XTermContainer ptyId={runnerPtyId} className="runner-xterm-container" />
        </div>
      </div>
    </>
  );
}
