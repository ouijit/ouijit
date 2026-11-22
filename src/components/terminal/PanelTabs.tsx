import type { ReactNode } from 'react';
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
import { terminalInstances } from './terminalRegistry';

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
export function PaneTab({
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
  return <Icon name={panelIcon(panel)} className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-ink/70' : 'text-ink/40'}`} />;
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
        <AddButton ptyId={ptyId} label="Open beside" />
      </div>
      {actions}
      <FullWidthToggle fullWidth={panelFullWidth} onToggle={() => ops.setPanelFullWidth(!panelFullWidth)} />
      <MinimizeButton onMinimize={ops.minimizePanel} />
    </div>
  );
}

/**
 * Where the main pane's header ends: with panels hidden, what is open beside
 * and a way back to it; with none, a way to open one.
 */
export function PanelsAway({ ptyId }: { ptyId: string }) {
  const { panels, activePanelId, diffPanelOpen } = usePanels(ptyId);
  const ops = useTerminalPanels(ptyId);
  if (activePanelId || diffPanelOpen) return null;
  if (panels.length === 0) return <AddButton ptyId={ptyId} label="Open beside" />;
  const reopen = () => {
    const last = terminalInstances.get(ptyId)?.lastActivePanelId;
    ops.activatePanel(panels.some((p) => p.id === last) ? last! : panels[panels.length - 1].id);
  };
  return (
    <button
      type="button"
      onClick={reopen}
      className="h-7 flex items-center gap-1.5 px-2 rounded-md border-none bg-transparent text-[13px] text-ink/50 hover:text-ink/80 hover:bg-ink/[0.04] transition-colors duration-150"
    >
      {panels.map((panel) => (
        <PanelMark key={panel.id} panel={panel} active={false} />
      ))}
      <span className="ml-0.5">{panels.length} open</span>
    </button>
  );
}

/** A card's main pane names what it holds, like any tab, so the two sides read alike. */
export function MainPaneHeader({ ptyId, surface }: { ptyId: string; surface: 'terminal' | 'chat' }) {
  return (
    <div className="h-10 flex items-center gap-0.5 px-2 shrink-0">
      <PaneTab
        icon={
          <Icon name={surface === 'chat' ? 'chat-circle' : 'terminal'} className="w-3.5 h-3.5 shrink-0 text-ink/70" />
        }
        label={surface === 'chat' ? 'Chat' : 'Terminal'}
        active
      />
      <span className="flex-1" />
      <PanelsAway ptyId={ptyId} />
    </div>
  );
}
