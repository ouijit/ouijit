/**
 * The three ways a project arrives, and the row that offers one.
 *
 * Shared by the home empty state and the add-project dialog so the wording a
 * first-time user reads is the wording they get back from the sidebar later.
 */

export type ProjectSourceKind = 'add-existing' | 'create' | 'clone';

export interface ProjectSource {
  kind: ProjectSourceKind;
  verb: string;
  noun: string;
  detail: string;
}

export const PROJECT_SOURCES: ProjectSource[] = [
  {
    kind: 'add-existing',
    verb: 'Open',
    noun: 'a folder you already have',
    detail: 'Brings an existing folder into Ouijit as a project.',
  },
  {
    kind: 'create',
    verb: 'Create',
    noun: 'a new project',
    detail: 'Creates a new folder, initialized as a git repo.',
  },
  {
    kind: 'clone',
    verb: 'Clone',
    noun: 'a repository from GitHub',
    detail: 'Clones it into your projects folder and opens it here.',
  },
];

export function ProjectSourceChoice({
  verb,
  noun,
  detail,
  onClick,
}: {
  verb: string;
  noun: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-baseline gap-3 w-full text-left px-5 py-3 hover:bg-ink/[0.04] transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-light outline-none [-webkit-app-region:no-drag]"
    >
      <span className="text-[15px] text-text-tertiary group-hover:text-text-primary transition-colors w-3 shrink-0">
        →
      </span>
      <span className="flex-1 min-w-0">
        <span className="text-[14px] text-text-primary">
          <span className="font-semibold">{verb}</span> <span className="text-text-secondary">{noun}.</span>
        </span>
        <span className="block text-[12px] text-text-tertiary mt-0.5 leading-relaxed">{detail}</span>
      </span>
    </button>
  );
}

export function ProjectSourceList({ onChoose }: { onChoose: (kind: ProjectSourceKind) => void }) {
  return (
    <div className="border-t border-ink/[0.06] divide-y divide-ink/[0.04]">
      {PROJECT_SOURCES.map((source) => (
        <ProjectSourceChoice key={source.kind} {...source} onClick={() => onChoose(source.kind)} />
      ))}
    </div>
  );
}
