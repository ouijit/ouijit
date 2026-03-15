import { useAppStore } from '../stores/appStore';

export function TitleBar() {
  const activeProjectData = useAppStore((s) => s.activeProjectData);
  const activeView = useAppStore((s) => s.activeView);

  return (
    <header className="header">
      <div className="header-content">
        {activeView === 'project' && activeProjectData && (
          <span className="header-project-name">{activeProjectData.name}</span>
        )}
      </div>
    </header>
  );
}
