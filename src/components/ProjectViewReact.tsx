import { useAppStore } from '../stores/appStore';

export function ProjectView() {
  const projectData = useAppStore((s) => s.activeProjectData);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--text-secondary)',
        fontSize: '14px',
      }}
    >
      {projectData ? projectData.name : 'No project selected'}
    </div>
  );
}
