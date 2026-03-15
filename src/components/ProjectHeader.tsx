import { useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useProjectStore } from '../stores/projectStore';
import { stringToColor, getInitials } from '../utils/projectIcon';
import { Icon } from './terminal/Icon';
import { addProjectTerminal } from './terminal/terminalActions';

interface ProjectHeaderProps {
  onNewTask: () => void;
}

export function ProjectHeader({ onNewTask }: ProjectHeaderProps) {
  const projectData = useAppStore((s) => s.activeProjectData);
  const projectPath = useAppStore((s) => s.activeProjectPath);
  const kanbanVisible = useProjectStore((s) => s.kanbanVisible);

  const handleToggleView = useCallback((view: 'board' | 'stack') => {
    useProjectStore.getState().setKanbanVisible(view === 'board');
  }, []);

  const handleNewTerminal = useCallback(() => {
    if (projectPath) addProjectTerminal(projectPath);
  }, [projectPath]);

  if (!projectData || !projectPath) return null;

  return (
    <div className="project-header-content">
      {projectData.iconDataUrl ? (
        <img src={projectData.iconDataUrl} alt="" className="project-header-icon" />
      ) : (
        <div
          className="project-header-icon project-header-icon--placeholder"
          style={{ backgroundColor: stringToColor(projectData.name) }}
        >
          {getInitials(projectData.name)}
        </div>
      )}
      <div className="project-header-info">
        <span className="project-header-name">{projectData.name}</span>
        <span className="project-header-path">{projectPath}</span>
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
      <button className="project-terminal-btn" title="New terminal" onClick={handleNewTerminal}>
        <Icon name="terminal" />
      </button>
      <button className="project-newtask-btn" title="New task" onClick={onNewTask}>
        <Icon name="plus" />
      </button>
    </div>
  );
}
