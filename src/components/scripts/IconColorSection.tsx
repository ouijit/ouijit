import { useAppStore } from '../../stores/appStore';
import { PROJECT_ICON_COLORS, projectIconColor, getInitials, stringToColor } from '../../utils/projectIcon';

interface IconColorSectionProps {
  projectPath: string;
}

export function IconColorSection({ projectPath }: IconColorSectionProps) {
  const project = useAppStore((s) => s.projects.find((p) => p.path === projectPath));

  if (!project) return null;

  const generatedColor = stringToColor(project.name);
  const currentColor = projectIconColor(project);
  const isCustom = project.iconColor != null;

  const apply = async (color: string | null) => {
    await window.api.setProjectIconColor(projectPath, color);
    const refreshed = await window.api.refreshProjects();
    useAppStore.getState().setProjects(refreshed);
  };

  return (
    <div className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden bg-[var(--color-terminal-bg,#171717)]">
      <div className="flex items-center gap-4 px-4 py-4">
        <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden">
          {project.iconDataUrl ? (
            <img src={project.iconDataUrl} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-base font-bold text-white"
              style={{ backgroundColor: currentColor, textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
            >
              {getInitials(project.name)}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">Icon color</div>
          <div className="text-xs text-text-tertiary mt-0.5">
            {project.iconDataUrl
              ? 'This project uses an icon image, so the color only shows where the image is unavailable.'
              : 'The color behind the project initials.'}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Automatic color"
          aria-pressed={!isCustom}
          onClick={() => void apply(null)}
          className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white transition-transform duration-100 hover:scale-110 ${
            !isCustom ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-terminal-bg,#171717)]' : ''
          }`}
          style={{ backgroundColor: generatedColor, textShadow: '0 1px 1px rgba(0, 0, 0, 0.3)' }}
          title="Automatic (generated from name)"
        >
          A
        </button>
        {PROJECT_ICON_COLORS.map((color) => {
          const selected = isCustom && project.iconColor === color;
          return (
            <button
              key={color}
              type="button"
              aria-label={`Set icon color ${color}`}
              aria-pressed={selected}
              onClick={() => void apply(color)}
              className={`w-7 h-7 rounded-full transition-transform duration-100 hover:scale-110 ${
                selected ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--color-terminal-bg,#171717)]' : ''
              }`}
              style={{ backgroundColor: color }}
            />
          );
        })}
      </div>
    </div>
  );
}
