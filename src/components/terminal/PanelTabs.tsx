import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTerminalStore } from '../../stores/terminalStore';
import { Icon } from './Icon';
import { RunnerDot } from './StatusDot';
import { Tooltip } from '../ui/Tooltip';
import { FullWidthToggle, MinimizeButton, PANEL_HEADER_BUTTON } from './FullWidthToggle';
import { panelIcon, panelLabel, type RunnerStatus, type TerminalPanel } from './panelTypes';
import { SANDBOX_LABELS } from '../../types';
import { useTerminalPanels } from './useTerminalPanels';
import { useAddPanelMenu } from './addPanelMenuStore';

const EMPTY: TerminalPanel[] = [];

function usePanels(ptyId: string) {
  return useTerminalStore(
    useShallow((s) => {
      const d = s.displayStates[ptyId];
      return {
        panels: d?.panels ?? EMPTY,
        activePanelId: d?.activePanelId ?? null,
        panelFullWidth: d?.panelFullWidth ?? false,
        diffPanelOpen: d?.diffPanelOpen ?? false,
      };
    }),
  );
}

/** A tab in a pane's header: quiet, the open one lifted, its close on hover. */
function PaneTab({
  icon,
  label,
  active,
  onClick,
  onClose,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
  onClose?: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`group/tab h-7 min-w-0 max-w-[220px] flex items-center gap-1.5 pl-2 ${onClose ? 'pr-1' : 'pr-2.5'} rounded-md border-none text-[13px] transition-colors duration-150 ${
        active ? 'bg-ink/[0.07] text-ink/85' : 'bg-transparent text-ink/50 hover:text-ink/80 hover:bg-ink/[0.04]'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {onClose && (
        <span
          role="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={`w-5 h-5 flex items-center justify-center rounded shrink-0 hover:bg-ink/10 [&>svg]:w-3 [&>svg]:h-3 ${
            active ? 'opacity-60' : 'opacity-0 group-hover/tab:opacity-60'
          }`}
        >
          <Icon name="x" />
        </span>
      )}
    </button>
  );
}

const RUNNER_LABELS: Record<RunnerStatus, string> = {
  running: 'Running',
  success: 'Exited',
  error: 'Failed',
  idle: 'Stopped',
};

function PanelMark({ panel, active }: { panel: TerminalPanel; active: boolean }) {
  if (panel.kind === 'runner')
    return (
      <Tooltip
        text={[RUNNER_LABELS[panel.status], panel.sandboxProvider && SANDBOX_LABELS[panel.sandboxProvider]]
          .filter(Boolean)
          .join(' · ')}
        placement="top"
        delay={300}
      >
        <RunnerDot status={panel.status} sandboxProvider={panel.sandboxProvider} />
      </Tooltip>
    );
  if (panel.kind === 'webPreview' && panel.favicon) return <Favicon src={panel.favicon} active={active} />;
  return <Icon name={panelIcon(panel)} className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-ink/70' : 'text-ink/40'}`} />;
}

function Favicon({ src, active }: { src: string; active: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === src)
    return <Icon name="globe-simple" className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-ink/70' : 'text-ink/40'}`} />;
  return (
    <img
      src={src}
      alt=""
      className="w-3.5 h-3.5 shrink-0 rounded-[3px] object-contain"
      onError={() => setBroken(src)}
    />
  );
}

function AddButton({ ptyId, label }: { ptyId: string; label: string }) {
  const show = useAddPanelMenu((s) => s.show);
  return (
    <Tooltip text={label}>
      <button
        type="button"
        className={PANEL_HEADER_BUTTON}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          show(ptyId, e.currentTarget);
        }}
      >
        <Icon name="plus" />
      </button>
    </Tooltip>
  );
}

/** The side pane's header: its tabs, then what the open one does, then the pane's own controls. */
export function PanelBar({ ptyId, actions }: { ptyId: string; actions?: ReactNode }) {
  const { panels, activePanelId, panelFullWidth } = usePanels(ptyId);
  const ops = useTerminalPanels(ptyId);
  return (
    <div className="h-10 flex items-center gap-0.5 px-2 shrink-0">
      <div role="tablist" aria-label="Panels" className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden">
        {panels.map((panel) => {
          const active = panel.id === activePanelId;
          return (
            <PaneTab
              key={panel.id}
              icon={<PanelMark panel={panel} active={active} />}
              label={panelLabel(panel)}
              active={active}
              onClick={() => ops.activatePanel(panel.id)}
              onClose={() => ops.closePanel(panel.id)}
            />
          );
        })}
        <AddButton ptyId={ptyId} label="New tab" />
      </div>
      {actions}
      <FullWidthToggle fullWidth={panelFullWidth} onToggle={() => ops.setPanelFullWidth(!panelFullWidth)} />
      <MinimizeButton onMinimize={ops.minimizePanel} />
    </div>
  );
}

/** How long the tucked tabs take to spread; they take no clicks until they have. */
const SPREAD_MS = 180;

/**
 * What is hidden beside the main pane, tucked into a stack of its tabs'
 * icons, and a new tab. Near the pointer the stack spreads out, each icon
 * opening its tab. The area that spreads it reaches past it, so the icons are
 * in place before the pointer is, and none takes a click while still moving.
 */
export function PanelsAway({ ptyId }: { ptyId: string }) {
  const { panels, activePanelId, diffPanelOpen } = usePanels(ptyId);
  const ops = useTerminalPanels(ptyId);
  const [near, setNear] = useState(false);
  const [settled, setSettled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  if (activePanelId || diffPanelOpen) return null;
  const approach = () => {
    setNear(true);
    clearTimeout(timer.current ?? undefined);
    timer.current = setTimeout(() => setSettled(true), SPREAD_MS);
  };
  const leave = () => {
    setNear(false);
    setSettled(false);
    clearTimeout(timer.current ?? undefined);
  };
  return (
    <div onMouseEnter={approach} onMouseLeave={leave} className="-m-6 p-6">
      <div className="h-7 flex items-center gap-0.5">
        {panels.map((panel, n) => (
          <Tooltip key={panel.id} text={panelLabel(panel)} placement="bottom">
            <button
              type="button"
              aria-label={panelLabel(panel)}
              onClick={() => settled && ops.activatePanel(panel.id)}
              className={`relative w-7 h-7 flex items-center justify-center rounded-md border-none ${
                near ? 'bg-transparent hover:bg-ink/10' : ''
              }`}
              style={{
                marginLeft: n === 0 ? 0 : near ? 2 : -5,
                zIndex: panels.length - n,
                ...(!near && {
                  background: 'color-mix(in srgb, var(--color-ink) 7%, var(--color-terminal-bg))',
                  boxShadow: '0 0 0 2px var(--color-terminal-bg)',
                }),
                transition: `margin-left ${SPREAD_MS}ms cubic-bezier(.2,.8,.2,1), background-color ${SPREAD_MS}ms, box-shadow ${SPREAD_MS}ms`,
              }}
            >
              <PanelMark panel={panel} active />
            </button>
          </Tooltip>
        ))}
        <AddButton ptyId={ptyId} label="New tab" />
      </div>
    </div>
  );
}

/**
 * In the main pane's corner while nothing is open beside it, over a fade of
 * what is under it rather than a row of its own.
 */
export function MainPaneCorner({ ptyId }: { ptyId: string }) {
  const { activePanelId, diffPanelOpen } = usePanels(ptyId);
  if (activePanelId || diffPanelOpen) return null;
  return (
    <div
      className="absolute top-0 right-0 z-10 pl-10 pr-2 pt-1.5 pb-1 pointer-events-none [&>*]:pointer-events-auto"
      style={{
        background:
          'linear-gradient(to right, color-mix(in srgb, var(--color-terminal-bg) 0%, transparent), var(--color-terminal-bg) 32px)',
      }}
    >
      <PanelsAway ptyId={ptyId} />
    </div>
  );
}
