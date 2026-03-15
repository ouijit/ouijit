import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { addProjectTerminal } from './terminal/terminalActions';
import { focusKanbanAddInput } from './kanban/KanbanAddInput';
import { LaunchDropdown } from './dropdowns/LaunchDropdown';
import { Tooltip } from './ui/Tooltip';

export function TitleBar() {
  const activeProjectData = useAppStore((s) => s.activeProjectData);
  const activeProjectPath = useAppStore((s) => s.activeProjectPath);
  const activeView = useAppStore((s) => s.activeView);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);
  const homeGroupMode = useUIStore((s) => s.homeGroupMode);
  const [launchOpen, setLaunchOpen] = useState(false);
  const hooksBtnRef = useRef<HTMLButtonElement>(null);

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
    <header className="header">
      <div className="header-content">
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
              <button
                className={`project-view-toggle-btn${kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                data-view="board"
                title="Board view"
                onClick={() => handleToggleView('board')}
              >
                <Icon name="kanban" />
              </button>
              <button
                className={`project-view-toggle-btn${!kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                data-view="stack"
                title="Terminal stack"
                onClick={() => handleToggleView('stack')}
              >
                <Icon name="cards-three" />
              </button>
            </div>
            <div className="project-launch-wrapper">
              <Tooltip text="Scripts" placement="bottom">
                <button ref={hooksBtnRef} className="project-hooks-btn" onClick={() => setLaunchOpen(!launchOpen)}>
                  <Icon name="code" />
                  <Icon name="caret-down" className="project-hooks-caret" />
                </button>
              </Tooltip>
              {launchOpen && <LaunchDropdown anchorRef={hooksBtnRef} onClose={() => setLaunchOpen(false)} />}
            </div>
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
            <span className="home-header-label">Sessions</span>
            <div style={{ flex: 1 }} />
            <div className="project-view-toggle">
              <button
                className={`project-view-toggle-btn${homeGroupMode === 'project' ? ' project-view-toggle-btn--active' : ''}`}
                title="Group by project"
                onClick={() => useUIStore.getState().setHomeGroupMode('project')}
              >
                <Icon name="folder-open" />
              </button>
              <button
                className={`project-view-toggle-btn${homeGroupMode === 'tag' ? ' project-view-toggle-btn--active' : ''}`}
                title="Group by tag"
                onClick={() => useUIStore.getState().setHomeGroupMode('tag')}
              >
                <Icon name="tag" />
              </button>
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
