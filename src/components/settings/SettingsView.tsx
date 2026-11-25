import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useAppStore } from '../../stores/appStore';
import { loadScripts } from '../../stores/projectDataStore';
import { useExperimentalStore } from '../../stores/experimentalStore';
import { useWorktreeSettingsStore } from '../../stores/worktreeSettingsStore';
import { useEscape } from '../../hooks/useEscape';
import { Icon } from '../terminal/Icon';
import { MenuItem, MenuPopover } from '../ui/Menu';
import { SettingsTrigger } from '../ui/SettingsTrigger';
import { AppAppearanceSettings, AppGeneralSettings } from './AppSettingsSections';
import { ChatSettingsSection } from '../chat/ChatSettingsSection';
import { LinearSettingsSection } from '../LinearSettingsSection';
import {
  ProjectGeneralSettings,
  ProjectLensesSettings,
  ProjectLinearSettings,
  ProjectSandboxSettings,
  ProjectScriptsSettings,
  ProjectTasksSettings,
} from './ProjectSettingsSections';

/** Each the icon the app already shows for that thing where it has one: the board, a lens, Start in Sandbox, Issues. */
const APP_SECTIONS = {
  General: { icon: 'sliders-horizontal', render: () => <AppGeneralSettings /> },
  Appearance: { icon: 'palette', render: () => <AppAppearanceSettings /> },
  Chat: { icon: 'chat-circle', render: () => <ChatSettingsSection /> },
  Integrations: { icon: 'plugs-connected', render: () => <LinearSettingsSection /> },
} satisfies Record<string, { icon: string; render: () => ReactNode }>;

const PROJECT_SECTIONS = {
  General: { icon: 'sliders-horizontal', render: (path: string) => <ProjectGeneralSettings projectPath={path} /> },
  Tasks: { icon: 'kanban', render: (path: string) => <ProjectTasksSettings projectPath={path} /> },
  Scripts: { icon: 'terminal', render: (path: string) => <ProjectScriptsSettings projectPath={path} /> },
  Lenses: { icon: 'aperture', render: (path: string) => <ProjectLensesSettings projectPath={path} /> },
  Sandbox: { icon: 'shield-check', render: (path: string) => <ProjectSandboxSettings projectPath={path} /> },
  Linear: { icon: 'circle-dashed', render: (path: string) => <ProjectLinearSettings projectPath={path} /> },
} satisfies Record<string, { icon: string; render: (path: string) => ReactNode }>;

type AppSection = keyof typeof APP_SECTIONS;
type ProjectSection = keyof typeof PROJECT_SECTIONS;

/** Which section each side was last on, so moving between App and a project comes back to it. */
const useSections = create<{ app: AppSection; project: ProjectSection }>()(() => ({
  app: 'General',
  project: 'General',
}));

/** The project the Project sections are about while App is shown: the last one looked at. */
function useNavProject(scopePath: string | null): string | null {
  const projects = useAppStore((s) => s.projects);
  const before = useAppStore((s) => s.beforeSettings);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (scopePath) setLast(scopePath);
  }, [scopePath]);
  const fromBefore = before && 'projectPath' in before ? before.projectPath : null;
  const candidate = scopePath ?? last ?? fromBefore;
  return projects.some((p) => p.path === candidate) ? candidate : (projects[0]?.path ?? null);
}

function NavRow({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
      className={`w-full h-7 flex items-center gap-2.5 pl-2 rounded-[7px] text-[13px] ${
        selected ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-ink/5 hover:text-text-primary'
      }`}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function NavHeading({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-4 first:pt-0 pb-1 text-[11px] font-medium text-text-tertiary">{children}</div>;
}

function ProjectPicker({ projectPath, onPick }: { projectPath: string; onPick: (path: string) => void }) {
  const projects = useAppStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.path === projectPath);
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      className="w-56 max-h-[22rem]"
      trigger={(ref) => (
        <SettingsTrigger
          triggerRef={ref}
          label="Choose a project"
          value={current?.name ?? 'Project'}
          open={open}
          onToggle={() => setOpen(!open)}
        />
      )}
    >
      {projects.map((project) => (
        <MenuItem
          key={project.path}
          label={project.name}
          selected={project.path === projectPath}
          onClick={() => {
            setOpen(false);
            onPick(project.path);
          }}
        />
      ))}
    </MenuPopover>
  );
}

/**
 * Settings, App's and each project's, as one page: a list of sections down
 * the side and the chosen one beside it. `projectPath` is the project whose
 * settings are open; null shows App's.
 */
export function SettingsView({ projectPath }: { projectPath: string | null }) {
  const { app, project } = useSections();
  const navProject = useNavProject(projectPath);
  const linear = useExperimentalStore((s) => (navProject ? (s.flagsByProject[navProject]?.linear ?? false) : false));
  const projectSections = (Object.keys(PROJECT_SECTIONS) as ProjectSection[]).filter(
    (name) => name !== 'Linear' || linear,
  );
  const shownProjectSection = projectSections.includes(project) ? project : 'General';

  useEffect(() => {
    if (!navProject) return;
    loadScripts(navProject);
    void useWorktreeSettingsStore.getState().loadFor(navProject);
    void useExperimentalStore.getState().loadFor(navProject);
  }, [navProject]);

  useEscape(useCallback(() => useAppStore.getState().leaveSettings(), []));

  const openApp = (section: AppSection) => {
    useSections.setState({ app: section });
    useAppStore.getState().select({ kind: 'app-settings' });
  };
  const openProject = (path: string, section: ProjectSection) => {
    useSections.setState({ project: section });
    useAppStore.getState().openPage(path, 'settings');
  };

  return (
    <div
      className="flex h-full min-h-0 transition-[margin-left] duration-200 ease-out"
      style={{ marginLeft: 'var(--sidebar-offset, 0px)' }}
    >
      <nav aria-label="Settings" className="w-[220px] shrink-0 px-3 pt-4 pb-6 overflow-y-auto">
        <NavHeading>App</NavHeading>
        {(Object.keys(APP_SECTIONS) as AppSection[]).map((name) => (
          <NavRow
            key={name}
            icon={APP_SECTIONS[name].icon}
            label={name}
            selected={!projectPath && app === name}
            onClick={() => openApp(name)}
          />
        ))}
        {navProject && (
          <>
            <NavHeading>Project</NavHeading>
            <div className="px-1 pb-1.5">
              <ProjectPicker projectPath={navProject} onPick={(path) => openProject(path, shownProjectSection)} />
            </div>
            {projectSections.map((name) => (
              <NavRow
                key={name}
                icon={PROJECT_SECTIONS[name].icon}
                label={name}
                selected={projectPath === navProject && shownProjectSection === name}
                onClick={() => openProject(navProject, name)}
              />
            ))}
          </>
        )}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto settings-scrollable">
        <div className="px-6 pt-4 pb-16 w-full max-w-[44rem] space-y-8">
          <h1 className="text-base font-semibold text-text-primary">{projectPath ? shownProjectSection : app}</h1>
          {projectPath ? PROJECT_SECTIONS[shownProjectSection].render(projectPath) : APP_SECTIONS[app].render()}
        </div>
      </div>
    </div>
  );
}
