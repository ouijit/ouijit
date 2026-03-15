import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
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
          <div className="project-header-content">
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
              <Tooltip text="Board view">
                <button
                  className={`project-view-toggle-btn${kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                  data-view="board"
                  onClick={() => handleToggleView('board')}
                >
                  <Icon name="kanban" />
                </button>
              </Tooltip>
              <Tooltip text="Terminal stack">
                <button
                  className={`project-view-toggle-btn${!kanbanVisible ? ' project-view-toggle-btn--active' : ''}`}
                  data-view="stack"
                  onClick={() => handleToggleView('stack')}
                >
                  <Icon name="cards-three" />
                </button>
              </Tooltip>
            </div>
            <div className="project-launch-wrapper">
              <Tooltip text="Scripts">
                <button ref={hooksBtnRef} className="project-hooks-btn" onClick={() => setLaunchOpen(!launchOpen)}>
                  <Icon name="code" />
                  <Icon name="caret-down" className="project-hooks-caret" />
                </button>
              </Tooltip>
              {launchOpen && <LaunchDropdown anchorRef={hooksBtnRef} onClose={() => setLaunchOpen(false)} />}
            </div>
            <Tooltip text="New terminal">
              <button className="project-terminal-btn" onClick={handleNewTerminal}>
                <Icon name="terminal" />
              </button>
            </Tooltip>
            <Tooltip text="New task">
              <button className="project-newtask-btn" onClick={handleNewTask}>
                <Icon name="plus" />
              </button>
            </Tooltip>
          </div>
        ) : (
          activeView === 'project' &&
          activeProjectData && <span className="header-project-name">{activeProjectData.name}</span>
        )}
      </div>
    </header>
  );
}
