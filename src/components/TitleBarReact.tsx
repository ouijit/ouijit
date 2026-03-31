import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { addProjectTerminal } from './terminal/terminalActions';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import { SandboxDropdown } from './dropdowns/SandboxDropdown';
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
  const activePanel = useProjectStore((s) => s.activePanel);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);
  const sandboxAvailable = useAppStore((s) => s.sandboxAvailable);
  const sandboxVmStatus = useAppStore((s) => s.sandboxVmStatus);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const sandboxStarting = useAppStore((s) => s.sandboxStarting);
  const [username, setUsername] = useState('');
  const sandboxBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.api.homePath().then((p) => setUsername(p.split('/').pop() || 'Home'));
  }, []);

  // Fetch sandbox status when switching projects + poll for VM status changes
  useEffect(() => {
    if (!activeProjectPath) {
      useAppStore.getState().setSandboxStatus(false, '');
      return;
    }
    window.api.lima.status(activeProjectPath).then((s) => {
      useAppStore.getState().setSandboxStatus(s.available, s.vmStatus);
    });

    const cleanup = window.api.lima.onSpawnProgress(() => {
      useAppStore.getState().setSandboxStarting(true);
    });

    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(activeProjectPath);
        const { sandboxStarting: starting } = useAppStore.getState();
        // While the VM is starting, Lima can report transient states (e.g. Broken).
        // Only update the store once it reaches Running; ignore intermediate states.
        if (starting) {
          if (s.vmStatus === 'Running') {
            useAppStore.getState().setSandboxStarting(false);
            useAppStore.getState().setSandboxStatus(s.available, s.vmStatus);
          }
        } else {
          useAppStore.getState().setSandboxStatus(s.available, s.vmStatus);
        }
      } catch {
        /* ignore */
      }
    }, 5000);

    return () => {
      cleanup();
      clearInterval(poll);
      useAppStore.getState().setSandboxStarting(false);
    };
  }, [activeProjectPath]);

  const handleToggleView = useCallback((view: 'board' | 'stack' | 'settings') => {
    const store = useProjectStore.getState();
    if (view === 'settings') {
      store.setActivePanel('settings');
    } else {
      store.setActivePanel('terminals');
      store.setKanbanVisible(view === 'board');
    }
  }, []);

  const handleNewTerminal = useCallback(() => {
    if (activeProjectPath) {
      addProjectTerminal(activeProjectPath);
      useProjectStore.getState().setKanbanVisible(false);
    }
  }, [activeProjectPath]);

  const handleNewTask = useCallback(() => {
    useProjectStore.getState().setKanbanVisible(true);
    requestAnimationFrame(() => focusKanbanAddInput());
  }, []);

  const isProjectOrHome = mode === 'project' || mode === 'home';
  const needsTrafficLightPad = isMac && !fullscreen;

  return (
    <header
      className={`sticky top-0 [-webkit-app-region:drag] ${isProjectOrHome ? 'z-[10000] border-b-0' : 'z-[100] border-b border-border'}`}
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
            <div className="flex items-center h-9 ml-3 bg-background-secondary border border-border rounded-[14px] overflow-hidden [-webkit-app-region:no-drag]">
              <TooltipButton
                text="Board view"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel !== 'settings' && kanbanVisible ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('board')}
              >
                <Icon name="kanban" />
              </TooltipButton>
              <TooltipButton
                text="Terminal stack"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel !== 'settings' && !kanbanVisible ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('stack')}
              >
                <Icon name="cards-three" />
              </TooltipButton>
              <TooltipButton
                text="Settings"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${activePanel === 'settings' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => handleToggleView('settings')}
              >
                <Icon name="gear" />
              </TooltipButton>
            </div>
            {sandboxAvailable && (
              <div className="relative flex ml-3">
                <Tooltip text="Sandbox" placement="bottom" disabled={sandboxOpen}>
                  <button
                    ref={sandboxBtnRef}
                    className={`relative h-9 flex items-center justify-center gap-1.5 px-2.5 border rounded-[14px] transition-[background-color,color,border-color] duration-150 [&>svg]:w-5 [&>svg]:h-5 ${
                      sandboxVmStatus === 'Running'
                        ? 'bg-[rgba(10,132,255,0.15)] border-[rgba(10,132,255,0.4)] text-[#409cff] hover:bg-[rgba(10,132,255,0.25)]'
                        : 'bg-background-secondary border-border text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
                    }`}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    onClick={() => setSandboxOpen(!sandboxOpen)}
                  >
                    <Icon
                      name="cube"
                      className={sandboxStarting ? 'animate-[sandbox-icon-pulse_1.5s_ease-in-out_infinite]' : ''}
                    />
                    <span className="[&_svg]:!w-3 [&_svg]:!h-3 opacity-50">
                      <Icon name="caret-down" />
                    </span>
                  </button>
                </Tooltip>
                {sandboxOpen && (
                  <SandboxDropdown
                    anchorRef={sandboxBtnRef}
                    onClose={() => {
                      setSandboxOpen(false);
                      if (activeProjectPath) {
                        window.api.lima.status(activeProjectPath).then((s) => {
                          useAppStore.getState().setSandboxStatus(s.available, s.vmStatus);
                          if (s.vmStatus === 'Running') useAppStore.getState().setSandboxStarting(false);
                        });
                      }
                    }}
                  />
                )}
              </div>
            )}
            <Tooltip text="New terminal" placement="bottom">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary border border-border rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                onClick={handleNewTerminal}
              >
                <Icon name="terminal" />
              </button>
            </Tooltip>
            <Tooltip text="New task" placement="bottom-end">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary border border-border rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
                onClick={handleNewTask}
              >
                <Icon name="plus" />
              </button>
            </Tooltip>
          </div>
        ) : activeView === 'home' ? (
          <div key="home-header" className="flex items-center gap-3 flex-1 px-4">
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-base font-semibold text-text-primary leading-tight">{username}</span>
              <span className="text-xs text-text-tertiary leading-tight truncate">~</span>
            </div>
            <div style={{ flex: 1 }} />
            <div className="flex items-center h-9 ml-3 bg-background-secondary border border-border rounded-[14px] overflow-hidden [-webkit-app-region:no-drag]">
              <TooltipButton
                text="Group by project"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${homeGroupMode === 'project' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => useUIStore.getState().setHomeGroupMode('project')}
              >
                <Icon name="folder-open" />
              </TooltipButton>
              <TooltipButton
                text="Group by tag"
                className={`w-9 h-full flex items-center justify-center text-text-secondary transition-all duration-150 ease-out hover:text-text-primary hover:bg-background-tertiary [&>svg]:w-5 [&>svg]:h-5${homeGroupMode === 'tag' ? ' text-text-primary bg-background-tertiary' : ''}`}
                onClick={() => useUIStore.getState().setHomeGroupMode('tag')}
              >
                <Icon name="tag" />
              </TooltipButton>
            </div>
            <Tooltip text="New terminal" placement="bottom">
              <button
                className="w-9 h-9 flex items-center justify-center bg-background-secondary border border-border rounded-[14px] text-text-secondary transition-all duration-150 ease-out ml-3 [-webkit-app-region:no-drag] hover:bg-background-tertiary hover:text-text-primary [&>svg]:w-5 [&>svg]:h-5"
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
    </header>
  );
}
