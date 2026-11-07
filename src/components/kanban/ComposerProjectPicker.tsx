import { useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useComposerStore } from '../../stores/composerStore';
import { Icon } from '../terminal/Icon';
import { MenuPopover } from '../ui/Menu';
import { ProjectTile } from '../ProjectTile';

/** Which project the new-task sheet creates in, changeable without losing the draft. */
export function ComposerProjectPicker({ projectPath }: { projectPath: string }) {
  const projects = useAppStore((s) => s.projects);
  const [open, setOpen] = useState(false);
  const current = projects.find((p) => p.path === projectPath);
  if (!current) return null;

  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      className="w-60 max-h-[22rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-label={`Project: ${current.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`inline-flex items-center gap-1.5 h-6 px-1.5 rounded-md text-[13px] text-text-secondary transition-colors duration-100 hover:bg-ink/[0.08] hover:text-text-primary ${
            open ? 'bg-ink/[0.08] text-text-primary' : ''
          }`}
          onClick={() => setOpen(!open)}
        >
          <ProjectTile project={current} />
          <span className="truncate max-w-[16rem]">{current.name}</span>
          <Icon name="caret-down" className="w-3 h-3 opacity-60" />
        </button>
      )}
    >
      {projects.map((project) => (
        <button
          key={project.path}
          type="button"
          role="menuitemradio"
          aria-checked={project.path === projectPath}
          className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-100"
          onClick={() => {
            setOpen(false);
            if (project.path !== projectPath) useComposerStore.getState().retarget(project.path);
          }}
        >
          <ProjectTile project={project} />
          <span className="flex-1 truncate">{project.name}</span>
          {project.path === projectPath && <Icon name="check" className="w-3.5 h-3.5 text-accent shrink-0" />}
        </button>
      ))}
    </MenuPopover>
  );
}
