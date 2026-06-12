/** Last segment of a path, for display (renderer-safe, no node:path). */
export function folderName(folderPath: string): string {
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folderPath;
}
