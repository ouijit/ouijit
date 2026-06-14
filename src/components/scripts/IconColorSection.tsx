import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { projectIconColor, getInitials, stringToColor } from '../../utils/projectIcon';

interface IconColorSectionProps {
  projectPath: string;
}

export function IconColorSection({ projectPath }: IconColorSectionProps) {
  const project = useAppStore((s) => s.projects.find((p) => p.path === projectPath));
  const resolvedColor = project ? projectIconColor(project) : '#000000';

  // Local state drives the live preview while dragging in the OS color panel;
  // the DB write is debounced so we don't rescan projects on every tick.
  const [color, setColor] = useState(resolvedColor);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from the store when the project's color changes elsewhere (e.g. reset).
  useEffect(() => {
    setColor(resolvedColor);
  }, [resolvedColor]);

  useEffect(() => () => clearTimeout(persistTimer.current ?? undefined), []);

  if (!project) return null;

  const generatedColor = stringToColor(project.name);
  const isCustom = project.iconColor != null;

  const persist = async (next: string | null) => {
    await window.api.setProjectIconColor(projectPath, next);
    const refreshed = await window.api.refreshProjects();
    useAppStore.getState().setProjects(refreshed);
  };

  const handlePick = (next: string) => {
    setColor(next);
    clearTimeout(persistTimer.current ?? undefined);
    persistTimer.current = setTimeout(() => void persist(next), 150);
  };

  const handleReset = () => {
    clearTimeout(persistTimer.current ?? undefined);
    setColor(generatedColor);
    void persist(null);
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
              style={{ backgroundColor: color, textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
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
        <div className="flex items-center gap-3 shrink-0">
          {isCustom && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-text-tertiary hover:text-text-primary outline-none focus-visible:underline"
            >
              Automatic
            </button>
          )}
          <label
            className="relative w-8 h-8 rounded-full overflow-hidden border border-white/15"
            style={{ backgroundColor: color }}
            title="Choose a color"
          >
            <input
              type="color"
              aria-label="Icon color"
              value={color}
              onChange={(e) => handlePick(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
