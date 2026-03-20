import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { addProjectTerminal } from './terminal/terminalActions';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import { LaunchDropdown } from './dropdowns/LaunchDropdown';
import { SandboxDropdown } from './dropdowns/SandboxDropdown';
import { Tooltip } from './ui/Tooltip';
import { TooltipButton } from './ui/TooltipButton';

export function TitleBar() {
  const activeProjectData = useAppStore((s) => s.activeProjectData);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeView = useAppStore((s) => s.activeView);
  const fullscreen = useAppStore((s) => s.fullscreen);
  const platform = useAppStore((s) => s.platform);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [sandboxVmStatus, setSandboxVmStatus] = useState('');
  const [sandboxStarting, setSandboxStarting] = useState(false);
  const [username, setUsername] = useState('');
  const hooksBtnRef = useRef<HTMLButtonElement>(null);
  const sandboxBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.api.homePath().then((p) => setUsername(p.split('/').pop() || 'Home'));
  }, []);

  // Check sandbox availability for the active project
  useEffect(() => {
    if (!activeProjectPath) {
      setSandboxAvailable(false);
      return;
    }
    window.api.lima.status(activeProjectPath).then((s) => {
      setSandboxAvailable(s.available);
      setSandboxVmStatus(s.vmStatus);
    });

    // Listen for sandbox spawn progress to show starting animation
    const cleanup = window.api.lima.onSpawnProgress(() => {
      setSandboxStarting(true);
    });

    // Poll to detect when VM finishes starting
    const poll = setInterval(async () => {
      try {
        const s = await window.api.lima.status(activeProjectPath);
        setSandboxVmStatus(s.vmStatus);
        if (s.vmStatus === 'Running') setSandboxStarting(false);
      } catch {
        /* ignore */
      }
    }, 5000);

    return () => {
      cleanup();
      clearInterval(poll);
      setSandboxStarting(false);
    };
  }, [activeProjectPath]);

  const handleToggleView = useCallback((view: 'board' | 'stack') => {
    useProjectStore.getState().setKanbanVisible(view === 'board');
  }, []);

  const handleNewTerminal = useCallback(() => {
    if (activeProjectPath) addProjectTerminal(activeProjectPath);
  }, [activeProjectPath]);

  const handleNewTask = useCallback(() => {
    useProjectStore.getState().setKanbanVisible(true);
    requestAnimationFrame(() => focusKanbanAddInput());
  }, []);

  return (
    <header
      className=""
      style={
        {
          background: 'rgba(28, 28, 30, 0.97)',
          WebkitAppRegion: 'drag',
          paddingTop: 'env(titlebar-area-height, 0px)',
        } as React.CSSProperties
      }
    >
      <div
        className="flex items-center justify-center gap-2 pr-6 py-4 transition-[padding-left] duration-200"
        style={{ paddingLeft: platform === 'darwin' && !fullscreen ? 80 : 24 }}
      >
        {activeView === 'project' && activeProjectData && activeProjectPath ? (
          <div key="project-header" className="project-header-content">
            {activeProjectData.iconDataUrl ? (
              <img src={activeProjectData.iconDataUrl} alt="" className="project-header-icon" />
            ) : (
              <div
                className="project-header-icon project-header-icon--placeholder"
                style={{ backgroundColor: stringToColor(activeProjectData.name) }}
              >
                {getInitials(activeProjectData.name)}
              </div>
            )}
            <div className="project-header-info">
              <span className="project-header-name">{activeProjectData.name}</span>
              <span className="project-header-path">{activeProjectPath}</span>
            </div>
            <div className="project-view-toggle">
              <TooltipButton
                text="Board view"
                className={`project-view-toggle-btn${kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                onClick={() => handleToggleView('board')}
              >
                <Icon name="kanban" />
              </TooltipButton>
              <TooltipButton
                text="Terminal stack"
                className={`project-view-toggle-btn${!kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                onClick={() => handleToggleView('stack')}
              >
                <Icon name="cards-three" />
              </TooltipButton>
            </div>
            <div className="project-launch-wrapper">
              <Tooltip text="Scripts" placement="bottom" disabled={launchOpen}>
                <button ref={hooksBtnRef} className="project-hooks-btn" onClick={() => setLaunchOpen(!launchOpen)}>
                  <Icon name="code" />
                  <Icon name="caret-down" className="project-hooks-caret" />
                </button>
              </Tooltip>
              {launchOpen && <LaunchDropdown anchorRef={hooksBtnRef} onClose={() => setLaunchOpen(false)} />}
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
                          setSandboxVmStatus(s.vmStatus);
                          if (s.vmStatus === 'Running') setSandboxStarting(false);
                        });
                      }
                    }}
                  />
                )}
              </div>
            )}
            <Tooltip text="New terminal" placement="bottom">
              <button className="project-terminal-btn" onClick={handleNewTerminal}>
                <Icon name="terminal" />
              </button>
            </Tooltip>
            <Tooltip text="New task" placement="bottom-end">
              <button className="project-newtask-btn" onClick={handleNewTask}>
                <Icon name="plus" />
              </button>
            </Tooltip>
          </div>
        ) : activeView === 'home' ? (
          <div key="home-header" className="project-header-content">
            <div className="project-header-info">
              <span className="project-header-name">{username}</span>
              <span className="project-header-path">~</span>
            </div>
            <div style={{ flex: 1 }} />
            <div className="project-view-toggle">
              <TooltipButton
                text="Group by project"
                className={`project-view-toggle-btn${homeGroupMode === 'project' ? ' project-view-toggle-btn--active' : ''}`}
                onClick={() => useUIStore.getState().setHomeGroupMode('project')}
              >
                <Icon name="folder-open" />
              </TooltipButton>
              <TooltipButton
                text="Group by tag"
                className={`project-view-toggle-btn${homeGroupMode === 'tag' ? ' project-view-toggle-btn--active' : ''}`}
                onClick={() => useUIStore.getState().setHomeGroupMode('tag')}
              >
                <Icon name="tag" />
              </TooltipButton>
            </div>
            <Tooltip text="New terminal" placement="bottom">
              <button
                className="project-terminal-btn"
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
