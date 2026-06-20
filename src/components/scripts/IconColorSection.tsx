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
      <label
        className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-white/[0.03]"
        title="Choose a color"
      >
        <div className="w-12 h-12 shrink-0 rounded-md overflow-hidden">
          <div
            className="w-full h-full flex items-center justify-center text-base font-bold text-white"
            style={{ backgroundColor: color, textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)' }}
          >
            {getInitials(project.name)}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary">Icon color</div>
          <div className="text-xs text-text-tertiary mt-0.5">The color behind the project initials.</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isCustom && (
            <button
              type="button"
              // Inside the row label; preventDefault stops the click from also opening the color picker.
              onClick={(e) => {
                e.preventDefault();
                handleReset();
              }}
              className="text-xs text-text-tertiary hover:text-text-primary outline-none focus-visible:underline"
            >
              Automatic
            </button>
          )}
          <span
            className="relative w-8 h-8 rounded-full overflow-hidden border border-white/15 transition-colors group-hover:border-white/30"
            style={{ backgroundColor: color }}
          >
            <input
              type="color"
              aria-label="Icon color"
              value={color}
              onChange={(e) => handlePick(e.target.value)}
              className="absolute inset-0 w-full h-full opacity-0"
            />
          </span>
        </div>
      </label>
    </div>
  );
}
