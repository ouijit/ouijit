import { useCallback, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore, type TerminalLayout } from '../stores/projectStore';
import { useExperimentalStore } from '../stores/experimentalStore';
import { useUIStore } from '../stores/uiStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { addProjectTerminal } from './terminal/terminalActions';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import { Tooltip } from './ui/Tooltip';
import { TooltipButton } from './ui/TooltipButton';

const isMac = navigator.platform.toLowerCase().includes('mac');

interface TitleBarProps {
  mode: string;
}

export function TitleBar({ mode }: TitleBarProps) {
  const activeProjectData = useAppStore((s) => s.activeProjectData);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeView = useAppStore((s) => s.activeView);
  const fullscreen = useAppStore((s) => s.fullscreen);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);
  const terminalLayout = useProjectStore((s) => s.terminalLayout);
  const activePanel = useProjectStore((s) => s.activePanel);
  const homeActivePanel = useAppStore((s) => s.homeActivePanel);
  const canvasEnabled = useExperimentalStore((s) =>
    activeProjectPath ? (s.flagsByProject[activeProjectPath]?.canvas ?? false) : false,
  );
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);

  // Fetch sandbox availability when switching projects
  useEffect(() => {
    if (!activeProjectPath) {
      useAppStore.getState().setSandboxStatus(false, '');
      return;
    }
    window.api.lima.status(activeProjectPath).then((s) => {
      useAppStore.getState().setSandboxStatus(s.available, s.vmStatus);
    });
  }, [activeProjectPath]);

  const handleToggleView = useCallback((view: 'board' | 'stack' | 'canvas' | 'settings') => {
    const store = useProjectStore.getState();
    if (view === 'settings') {
      store.setActivePanel('settings');
    } else if (view === 'board') {
      store.setActivePanel('terminals');
      store.setKanbanVisible(true);
    } else {
      store.setActivePanel('terminals');
      store.setKanbanVisible(false);
      store.setTerminalLayout(view as TerminalLayout);
    }
  }, []);

  const handleNewTerminal = useCallback(() => {
    if (activeProjectPath) {
      addProjectTerminal(activeProjectPath);
      const store = useProjectStore.getState();
      store.setActivePanel('terminals');
      store.setKanbanVisible(false);
    }
  }, [activeProjectPath]);

  const handleNewTask = useCallback(() => {
    const store = useProjectStore.getState();
    store.setActivePanel('terminals');
    store.setKanbanVisible(true);
    requestAnimationFrame(() => focusKanbanAddInput());
  }, []);

  const isProjectOrHome = mode === 'project' || mode === 'home';
  const needsTrafficLightPad = isMac && !fullscreen;

  return (
    <header
      className={`sticky top-0 relative [-webkit-app-region:drag] ${isProjectOrHome ? 'z-[10000] border-b-0' : 'z-[100] border-b border-border'}`}
      style={
        {
          background: 'rgba(28, 28, 30, 0.97)',
          WebkitAppRegion: 'drag',
          paddingTop: 'env(titlebar-area-height, 0px)',
        } as React.CSSProperties
      }
    >
      <div
        className={`mx-auto flex items-center gap-2 transition-[padding-left] duration-200 ${
          isProjectOrHome
            ? `max-w-none px-0 pt-4 pb-2 ${mode === 'home' ? 'justify-start' : 'justify-center'}`
            : 'max-w-[var(--content-max-width)] px-6 py-4 justify-center'
        }`}
        style={{ paddingLeft: needsTrafficLightPad ? 80 : 16 }}
      >
        {/* Sidebar toggle — in header flow on Linux/fullscreen, absolute below traffic lights on macOS */}
        {isProjectOrHome && !needsTrafficLightPad && (
          <button
            className="flex items-center justify-center text-white/25 transition-colors duration-150 hover:text-white/50 [-webkit-app-region:no-drag] [&>svg]:w-[18px] [&>svg]:h-[18px]"
            style={{ width: 28, height: 28 }}
            onClick={() => document.dispatchEvent(new CustomEvent('show-sidebar'))}
          >
            <Icon name="arrow-left" />
          </button>
        )}

        {activeView === 'project' && activeProjectData && activeProjectPath ? (
          <div key="project-header" className="flex items-center gap-3 flex-1 px-4">
            {activeProjectData.iconDataUrl ? (
              <img src={activeProjectData.iconDataUrl} alt="" className="w-8 h-8 rounded-md object-cover" />
            ) : (
              <div
                className="w-8 h-8 rounded-md object-cover flex items-center justify-center text-base font-bold text-white"
                style={{
                  backgroundColor: stringToColor(activeProjectData.name),
                  textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                }}
              >
                {getInitials(activeProjectData.name)}
              </div>
            )}
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-base font-semibold text-text-primary leading-tight">{activeProjectData.name}</span>
              <span className="text-xs text-text-tertiary leading-tight truncate">{activeProjectPath}</span>
            </div>
            <div className="flex items-center h-9 ml-3 bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden [-webkit-app-region:no-drag]">
              <TooltipButton
                text="Board view"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel !== 'settings' && kanbanVisible ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('board')}
              >
                <Icon name="kanban" />
              </TooltipButton>
              <TooltipButton
                text="Terminal stack"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel !== 'settings' && !kanbanVisible && terminalLayout === 'stack' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('stack')}
              >
                <Icon name="cards-three" />
              </TooltipButton>
              {canvasEnabled && (
                <TooltipButton
                  text="Canvas"
                  className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel !== 'settings' && !kanbanVisible && terminalLayout === 'canvas' ? ' text-text-primary bg-background-tertiary' : ''}`}
                  onClick={() => handleToggleView('canvas')}
                >
                  <CanvasIcon />
                </TooltipButton>
              )}
              <TooltipButton
                text="Settings"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel === 'settings' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('settings')}
              >
                <Icon name="gear" />
              </TooltipButton>
            </div>
            <Tooltip text="New terminal" placement="bottom">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                onClick={handleNewTerminal}
              >
                <Icon name="terminal" />
              </button>
            </Tooltip>
            <Tooltip text="New task" placement="bottom-end">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                onClick={handleNewTask}
              >
                <Icon name="plus" />
              </button>
            </Tooltip>
          </div>
        ) : activeView === 'home' ? (
          <div key="home-header" className="flex items-center gap-3 flex-1 px-4">
            <div className="w-8 h-8 flex items-center justify-center">
              <div
                aria-hidden
                className="sidebar-home-logo-mask w-7 h-7"
                style={{ backgroundColor: 'var(--color-text-primary)' }}
              />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-base font-semibold text-text-primary leading-tight">Ouijit</span>
            </div>
            <div style={{ flex: 1 }} />
            <div className="flex items-center h-9 ml-3 bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden [-webkit-app-region:no-drag]">
              <TooltipButton
                text="Group by project"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${homeActivePanel !== 'settings' && homeGroupMode === 'project' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => {
                  useAppStore.getState().setHomeActivePanel('home');
                  useUIStore.getState().setHomeGroupMode('project');
                }}
              >
                <Icon name="folder-open" />
              </TooltipButton>
              <TooltipButton
                text="Group by tag"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${homeActivePanel !== 'settings' && homeGroupMode === 'tag' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => {
                  useAppStore.getState().setHomeActivePanel('home');
                  useUIStore.getState().setHomeGroupMode('tag');
                }}
              >
                <Icon name="tag" />
              </TooltipButton>
              <TooltipButton
                text="Settings"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${homeActivePanel === 'settings' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => useAppStore.getState().setHomeActivePanel('settings')}
              >
                <Icon name="gear" />
              </TooltipButton>
            </div>
            <Tooltip text="New terminal" placement="bottom">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary glass-bevel relative border border-black/60 rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                onClick={async () => {
                  const homePath = await window.api.homePath();
                  addProjectTerminal(homePath);
                }}
              >
                <Icon name="terminal" />
              </button>
            </Tooltip>
          </div>
        ) : null}
      </div>
      {/* Sidebar toggle below traffic lights — absolute so it doesn't affect header flow */}
      {isProjectOrHome && needsTrafficLightPad && (
        <button
          className="absolute flex items-center justify-center text-white/25 transition-colors duration-150 hover:text-white/50 [-webkit-app-region:no-drag] [&>svg]:w-[18px] [&>svg]:h-[18px]"
          style={{ left: 24, bottom: -14, width: 28, height: 28 }}
          onClick={() => document.dispatchEvent(new CustomEvent('show-sidebar'))}
        >
          <Icon name="arrow-left" />
        </button>
      )}
    </header>
  );
}

/** Inline canvas/artboard icon — no Phosphor equivalent available. */
function CanvasIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" className="w-5 h-5 shrink-0">
      <rect x="40" y="40" width="72" height="72" rx="8" opacity="0.9" />
      <rect x="144" y="40" width="72" height="52" rx="8" opacity="0.7" />
      <rect x="40" y="144" width="72" height="52" rx="8" opacity="0.7" />
      <rect x="144" y="124" width="72" height="72" rx="8" opacity="0.9" />
    </svg>
  );
}
