import { useProjectStore } from '../stores/projectStore';

/**
 * What the OS calls its file manager, for menu labels.
 * Linux desktops each ship a different one (Nautilus, Dolphin, Thunar), so the
 * generic name is the only accurate label there.
 */
export function fileManagerName(platform: string = navigator.platform): string {
  const p = platform.toLowerCase();
  if (p.includes('mac')) return 'Finder';
  if (p.includes('win')) return 'File Explorer';
  return 'File Manager';
}

export const FILE_MANAGER_NAME = fileManagerName();

/**
 * Reveals a directory in the OS file manager, toasting when the OS refuses —
 * a worktree deleted outside Ouijit would otherwise make the menu item look
 * broken.
 */
export async function revealInFileManager(targetPath: string): Promise<void> {
  const result = await window.api.openInFinder(targetPath);
  if (!result.success) {
    useProjectStore.getState().addToast(`Could not open ${FILE_MANAGER_NAME}: ${targetPath}`, 'error');
  }
}
