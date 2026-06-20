import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { Tooltip } from '../ui/Tooltip';
import { AddPanelMenu } from './AddPanelMenu';
import { panelIcon, panelLabel, type TerminalPanel } from './panelTypes';
import type { RunnerScript } from '../../types';

interface PanelTabStripProps {
  ptyId: string;
  projectPath: string;
  panels: TerminalPanel[];
  activePanelId: string | null;
  panelFullWidth: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSetFullWidth: (fullWidth: boolean) => void;
  onAddRunner: (script?: RunnerScript) => void;
  onAddWebPreview: () => void;
  onAddPlan: (planPath: string) => void;
}

const RUNNER_DOT: Record<string, string> = {
  running: 'bg-[#4ee82e]',
  success: 'bg-[#4ee82e]',
  error: 'bg-[#ff6b6b]',
  idle: 'bg-white/25',
};

export function PanelTabStrip({
  ptyId,
  projectPath,
  panels,
  activePanelId,
  panelFullWidth,
  onActivate,
  onClose,
  onSetFullWidth,
  onAddRunner,
  onAddWebPreview,
  onAddPlan,
}: PanelTabStripProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const hasActive = activePanelId != null && panels.some((p) => p.id === activePanelId);

  const openMenu = () => {
    const rect = addRef.current?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <div className="flex items-center gap-1 px-3 pt-2 pb-1.5 shrink-0 overflow-x-auto">
      {panels.map((panel) => {
        const active = panel.id === activePanelId;
        return (
          <button
            key={panel.id}
            onClick={() => onActivate(panel.id)}
            className={`group/tab relative inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md text-[13px] font-medium shrink-0 transition-colors duration-150 ${
              active
                ? 'text-text-primary bg-white/[0.08]'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            {panel.kind === 'runner' ? (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${RUNNER_DOT[panel.status] ?? 'bg-white/25'}`} />
            ) : (
              <Icon name={panelIcon(panel)} className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate max-w-[140px]">{panelLabel(panel)}</span>
            <span
              role="button"
              aria-label="Close panel"
              onClick={(e) => {
                e.stopPropagation();
                onClose(panel.id);
              }}
              className="w-4 h-4 flex items-center justify-center rounded shrink-0 opacity-0 group-hover/tab:opacity-100 transition-all duration-150 text-white/50 hover:bg-white/10 hover:text-white/90 [&>svg]:w-3 [&>svg]:h-3"
            >
              <Icon name="x" />
            </span>
          </button>
        );
      })}

      <Tooltip text="Add panel">
        <button
          ref={addRef}
          onClick={openMenu}
          className="w-7 h-7 flex items-center justify-center shrink-0 rounded-md bg-transparent border-none text-text-secondary hover:text-text-primary hover:bg-white/[0.05] transition-colors duration-150 [&>svg]:w-3.5 [&>svg]:h-3.5"
          aria-label="Add panel"
        >
          <Icon name="plus" />
        </button>
      </Tooltip>

      {hasActive && (
        <Tooltip text={panelFullWidth ? 'Split view' : 'Full width'}>
          <button
            onClick={() => onSetFullWidth(!panelFullWidth)}
            className="w-7 h-7 ml-auto flex items-center justify-center shrink-0 rounded-md bg-transparent border-none text-white/60 hover:bg-white/10 hover:text-white/90 transition-all duration-150 [&>svg]:w-3.5 [&>svg]:h-3.5"
            aria-label={panelFullWidth ? 'Split view' : 'Full width'}
          >
            <Icon name={panelFullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal'} />
          </button>
        </Tooltip>
      )}

      {menu && (
        <AddPanelMenu
          ptyId={ptyId}
          projectPath={projectPath}
          x={menu.x}
          y={menu.y}
          onAddRunner={onAddRunner}
          onAddWebPreview={onAddWebPreview}
          onAddPlan={onAddPlan}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
