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
 * broken. Callers fire this without awaiting, so a rejected invoke has to be
 * caught here or it surfaces as an unhandled rejection and a dead menu item.
 */
export async function revealInFileManager(targetPath: string): Promise<void> {
  const failed = (reason?: string): void => {
    const suffix = reason ? `: ${reason}` : '';
    useProjectStore.getState().addToast(`Could not open ${targetPath} in ${FILE_MANAGER_NAME}${suffix}`, 'error');
  };
  try {
    const result = await window.api.openInFinder(targetPath);
    if (!result.success) failed(result.error);
  } catch (err) {
    failed(err instanceof Error ? err.message : String(err));
  }
}
