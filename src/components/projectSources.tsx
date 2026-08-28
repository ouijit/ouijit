import { Icon } from './terminal/Icon';

export type ProjectSourceKind = 'add-existing' | 'create' | 'clone';

/** How a surface with no route to `App` asks for the add-project flow. */
export const ADD_PROJECT_EVENT = 'add-project';

export function openAddProject(kind: ProjectSourceKind): void {
  document.dispatchEvent(new CustomEvent<ProjectSourceKind>(ADD_PROJECT_EVENT, { detail: kind }));
}

interface ProjectSource {
  kind: ProjectSourceKind;
  icon: string;
  verb: string;
  noun: string;
  detail: string;
}

const PROJECT_SOURCES: ProjectSource[] = [
  {
    kind: 'add-existing',
    icon: 'folder-open',
    verb: 'Open',
    noun: 'a folder you already have',
    detail: 'Brings an existing folder into Ouijit as a project.',
  },
  {
    kind: 'create',
    icon: 'folder-plus',
    verb: 'Create',
    noun: 'a new project',
    detail: 'Creates a new folder, initialized as a git repo.',
  },
  {
    kind: 'clone',
    icon: 'github-logo',
    verb: 'Clone',
    noun: 'a repository from GitHub',
    detail: 'Clones it into your projects folder and opens it here.',
  },
];

function ProjectSourceChoice({ source, onClick }: { source: ProjectSource; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-baseline gap-3 w-full text-left px-5 py-3 hover:bg-ink/[0.04] transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-light outline-none [-webkit-app-region:no-drag]"
    >
      <span className="shrink-0 self-center w-8 h-8 rounded-md flex items-center justify-center bg-ink/[0.06] text-text-secondary transition-colors duration-150 group-hover:bg-ink/10 group-hover:text-text-primary">
        <Icon name={source.icon} className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-[14px] text-text-primary">
          <span className="font-semibold">{source.verb}</span>{' '}
          <span className="text-text-secondary">{source.noun}.</span>
        </span>
        <span className="block text-[12px] text-text-tertiary mt-0.5 leading-relaxed">{source.detail}</span>
      </span>
      <span className="shrink-0 self-center text-[15px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        →
      </span>
    </button>
  );
}

export function ProjectSourceList({
  title,
  onChoose,
}: {
  title?: string;
  onChoose: (kind: ProjectSourceKind) => void;
}) {
  return (
    <div
      className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden"
      style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-panel)' }}
    >
      {title && (
        <div className="px-5 py-3">
          <span className="text-sm text-text-primary leading-tight">{title}</span>
        </div>
      )}
      <div className={`${title ? 'border-t border-separator ' : ''}divide-y divide-separator`}>
        {PROJECT_SOURCES.map((source) => (
          <ProjectSourceChoice key={source.kind} source={source} onClick={() => onChoose(source.kind)} />
        ))}
      </div>
    </div>
  );
}
