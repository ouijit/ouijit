import { getInitials, projectIconColor } from '../utils/projectIcon';

/** A project's colour and initials, small enough to sit beside its name. */
export function ProjectTile({ project }: { project: { name: string; iconColor?: string } }) {
  return (
    <span
      aria-hidden="true"
      className="w-4 h-4 shrink-0 rounded flex items-center justify-center text-[7px] font-bold text-white"
      style={{ backgroundColor: projectIconColor(project), textShadow: '0 1px 1px rgba(0, 0, 0, 0.2)' }}
    >
      {getInitials(project.name)}
    </span>
  );
}
