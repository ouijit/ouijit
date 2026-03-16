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
      <div className="flex items-center justify-center gap-2 px-6 py-4">
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
                    className={`relative h-9 flex items-center justify-center gap-1.5 px-2.5 border rounded-[14px] transition-all duration-150 [&>svg]:w-5 [&>svg]:h-5 ${
                      sandboxVmStatus === 'Running'
                        ? 'bg-[rgba(10,132,255,0.15)] border-[rgba(10,132,255,0.4)] text-[#409cff] hover:bg-[rgba(10,132,255,0.25)]'
                        : sandboxStarting
                          ? 'bg-background-secondary border-transparent text-[#409cff]'
                          : 'bg-background-secondary border-border text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
                    }`}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    onClick={() => setSandboxOpen(!sandboxOpen)}
                  >
                    <Icon name="cube" />
                    <span className="[&_svg]:!w-3 [&_svg]:!h-3 opacity-50">
                      <Icon name="caret-down" />
                    </span>
                    {sandboxStarting && <SandboxBorderAnim />}
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

/** Animated dashed border that traces around the sandbox button while VM is starting */
function SandboxBorderAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const btn = ref.current?.parentElement;
    if (btn) {
      setDims({ w: btn.offsetWidth + 4, h: btn.offsetHeight + 4 });
    }
  }, []);

  if (dims.w === 0) return <svg ref={ref} className="absolute" style={{ width: 0, height: 0 }} />;

  const r = 16; // matches rounded-[14px] + 2px inset

  return (
    <svg
      ref={ref}
      className="absolute pointer-events-none overflow-visible"
      style={{ inset: -2, width: dims.w, height: dims.h }}
      viewBox={`0 0 ${dims.w} ${dims.h}`}
    >
      <rect
        x="0.5"
        y="0.5"
        width={dims.w - 1}
        height={dims.h - 1}
        rx={r}
        fill="none"
        stroke="#0A84FF"
        strokeWidth="1"
        pathLength="100"
        strokeDasharray="25 75"
        strokeLinecap="round"
        style={{ animation: 'sandbox-border-trace 1.5s linear infinite' }}
      />
    </svg>
  );
}
