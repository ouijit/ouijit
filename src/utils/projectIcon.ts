/** Palette used both for generated colors and the manual color picker. */
export const PROJECT_ICON_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
  '#BB8FCE',
  '#85C1E9',
  '#F8B500',
  '#FF8C00',
  '#00CED1',
  '#9370DB',
  '#3CB371',
  '#FF69B4',
  '#20B2AA',
  '#778899',
  '#B8860B',
  '#5F9EA0',
];

/**
 * Generate a consistent color from a string (project name)
 */
export function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return PROJECT_ICON_COLORS[Math.abs(hash) % PROJECT_ICON_COLORS.length];
}

/**
 * The icon color for a project: a manual override if set, otherwise the
 * color generated from the project name.
 */
export function projectIconColor(project: { name: string; iconColor?: string }): string {
  return project.iconColor ?? stringToColor(project.name);
}

/**
 * Get initials from project name (up to 2 characters)
 */
export function getInitials(name: string): string {
  const words = name.replace(/[-_]/g, ' ').split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}
