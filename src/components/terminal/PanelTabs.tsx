import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTerminalStore } from '../../stores/terminalStore';
import { Icon } from './Icon';
import { RunnerDot } from './StatusDot';
import { PANEL_HEADER_BUTTON } from './FullWidthToggle';
import { LabelTip, PanelTip, PanelTipGroup, TabTip } from './PanelTips';
import { panelIcon, panelLabel, type RunnerStatus, type TerminalPanel } from './panelTypes';
import { SANDBOX_LABELS, placementProvider } from '../../types';
import { useTerminalPanels } from './useTerminalPanels';
import { NewTabField } from './NewTabPanel';
import { SoftBlur } from '../ui/SoftBlur';

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
const TITLE_FADE = 'linear-gradient(to right, black calc(100% - 16px), transparent)';

function PaneTab({
  icon,
  label,
  active,
  onClick,
  onClose,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
  onClose?: () => void;
} & Omit<React.ComponentProps<'button'>, 'onClick'>) {
  return (
    <button
      {...rest}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      // Equal shares of the row, as browser tabs are: a tab's width never
      // depends on its title or on which one is open.
      className={`h-7 flex-[1_1_0] min-w-0 max-w-[200px] flex items-center gap-1.5 pl-2 ${onClose ? 'pr-1' : 'pr-2.5'} rounded-md border-none text-[13px] text-left transition-colors duration-150 ${
        active ? 'bg-ink/[0.1] text-ink/90' : 'bg-ink/[0.04] text-ink/55 hover:text-ink/80 hover:bg-ink/[0.07]'
      }`}
    >
      {icon}
      <span className="flex-1 min-w-0 overflow-hidden whitespace-nowrap" style={{ maskImage: TITLE_FADE }}>
        {label}
      </span>
      {onClose && (
        <span
          role="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={`w-5 h-5 shrink-0 flex items-center justify-center rounded-full hover:opacity-100 hover:bg-ink/10 [&>svg]:w-3 [&>svg]:h-3 ${
            active ? 'opacity-70' : 'opacity-40'
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
    return <RunnerDot status={panel.status} sandboxProvider={placementProvider(panel.sandbox)} />;
  if (panel.kind === 'webPreview' && panel.favicon) return <Favicon src={panel.favicon} active={active} />;
  return <Icon name={panelIcon(panel)} className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-ink/70' : 'text-ink/40'}`} />;
}

/** The end of a folder's path, which names it, rather than its start, which says little. */
function tailOfPath(dir: string, keep = 40): string {
  if (dir.length <= keep) return dir;
  const parts = dir.split('/');
  let tail = parts.pop() ?? '';
  while (parts.length && tail.length + parts[parts.length - 1].length + 1 <= keep - 2) tail = `${parts.pop()}/${tail}`;
  return `…/${tail}`;
}

/** Where a tab points, under its title in its tip. */
function panelDetail(panel: TerminalPanel): string | undefined {
  if (panel.kind === 'newTab') return undefined;
  if (panel.kind === 'webPreview') return panel.url?.replace(/^https?:\/\//, '') ?? undefined;
  if (panel.kind === 'plan') return tailOfPath(panel.planPath.replace(/\/[^/]+$/, '').replace(/^\/Users\/[^/]+/, '~'));
  const sandbox = placementProvider(panel.sandbox);
  const where = [RUNNER_LABELS[panel.status], sandbox && SANDBOX_LABELS[sandbox]];
  return [panel.command || panel.scriptCommand, ...where].filter(Boolean).join(' · ');
}

function PanelTabTip({ panel, children }: { panel: TerminalPanel; children: React.ReactElement }) {
  return (
    <PanelTip
      tip={<TabTip icon={<PanelMark panel={panel} active />} title={panelLabel(panel)} detail={panelDetail(panel)} />}
    >
      {children}
    </PanelTip>
  );
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
  const ops = useTerminalPanels(ptyId);
  return (
    <PanelTip tip={<LabelTip text={label} />}>
      <button
        type="button"
        className={PANEL_HEADER_BUTTON}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          ops.addNewTab();
        }}
      >
        <Icon name="plus" />
      </button>
    </PanelTip>
  );
}

function BarButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <PanelTip tip={<LabelTip text={label} />} placement="bottom-end">
      <button
        type="button"
        className={PANEL_HEADER_BUTTON}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        <Icon name={icon} />
      </button>
    </PanelTip>
  );
}

/** The side pane's header: its tabs, then the pane's own controls, the same whichever tab is open. */
export function PanelBar({ ptyId }: { ptyId: string }) {
  const { panels, activePanelId, panelFullWidth } = usePanels(ptyId);
  const ops = useTerminalPanels(ptyId);
  return (
    <PanelTipGroup>
      <div className="h-10 flex items-center gap-0.5 px-2 shrink-0">
        <div role="tablist" aria-label="Panels" className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
          {panels.map((panel) => {
            const active = panel.id === activePanelId;
            if (active && panel.kind === 'newTab')
              return (
                <NewTabField key={panel.id} ptyId={ptyId} panelId={panel.id} onClose={() => ops.closePanel(panel.id)} />
              );
            return (
              <PanelTabTip key={panel.id} panel={panel}>
                <PaneTab
                  icon={<PanelMark panel={panel} active={active} />}
                  label={panelLabel(panel)}
                  active={active}
                  onClick={() => ops.activatePanel(panel.id)}
                  onClose={() => ops.closePanel(panel.id)}
                />
              </PanelTabTip>
            );
          })}
          <AddButton ptyId={ptyId} label="New tab" />
        </div>
        <BarButton
          icon={panelFullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal'}
          label={panelFullWidth ? 'Split view' : 'Full width'}
          onClick={() => ops.setPanelFullWidth(!panelFullWidth)}
        />
        <BarButton icon="minus" label="Hide" onClick={ops.minimizePanel} />
      </div>
    </PanelTipGroup>
  );
}

/** What is hidden beside the main pane, each tab's icon opening it, and a new tab. */
export function PanelsAway({ ptyId }: { ptyId: string }) {
  const { panels, activePanelId, diffPanelOpen } = usePanels(ptyId);
  const ops = useTerminalPanels(ptyId);
  if (activePanelId || diffPanelOpen) return null;
  return (
    <PanelTipGroup>
      <div className="h-7 flex items-center gap-0.5">
        {panels.map((panel) => (
          <PanelTabTip key={panel.id} panel={panel}>
            <button
              type="button"
              aria-label={panelLabel(panel)}
              onClick={() => ops.activatePanel(panel.id)}
              className="w-7 h-7 flex items-center justify-center rounded-md border-none bg-transparent hover:bg-ink/10 transition-colors duration-150"
            >
              <PanelMark panel={panel} active />
            </button>
          </PanelTabTip>
        ))}
        <AddButton ptyId={ptyId} label="New tab" />
      </div>
    </PanelTipGroup>
  );
}

/**
 * Controls set in a pane's top right corner over what is under it, on a
 * blur that fades out to the left and below so it has no edge.
 */
export function PaneCorner({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-0 right-0 z-10 pl-10 pr-2 pt-1.5 pb-5 pointer-events-none [&>*]:pointer-events-auto">
      <SoftBlur fades={{ left: 40, bottom: 30 }} color="--color-terminal-bg" className="inset-0 !pointer-events-none" />
      <PanelTipGroup>
        <div className="relative flex items-center">{children}</div>
      </PanelTipGroup>
    </div>
  );
}

/** While nothing is open beside the main pane, what is hidden there sits in its corner. */
export function MainPaneCorner({ ptyId }: { ptyId: string }) {
  const { activePanelId, diffPanelOpen } = usePanels(ptyId);
  if (activePanelId || diffPanelOpen) return null;
  return (
    <PaneCorner>
      <PanelsAway ptyId={ptyId} />
    </PaneCorner>
  );
}
