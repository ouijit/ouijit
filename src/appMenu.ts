import { Menu, type MenuItemConstructorOptions } from 'electron';
import { folderName } from './utils/folderName';

interface AppMenuOptions {
  /** Vite dev-server URL — truthy only in dev (`npm start`), undefined in packaged builds. */
  devServerUrl: string | undefined;
  /** Repo/worktree root, used to derive the dev-instance label. */
  appPath: string;
}

/** Extract the dev-server port from its URL, or '' if it can't be parsed. */
function devServerPort(devServerUrl: string): string {
  try {
    return new URL(devServerUrl).port;
  } catch {
    return '';
  }
}

/**
 * Builds the native application menu. In dev, this replaces Electron's default
 * menu with a role-based equivalent (so copy/paste, DevTools, etc. are all
 * preserved) plus a disabled "Dev instance" label under Help that identifies
 * which worktree and dev-server port this window belongs to — the on-demand
 * replacement for the old titlebar badge.
 *
 * Returns null in production so the caller keeps Electron's default menu.
 */
export function buildAppMenu({ devServerUrl, appPath }: AppMenuOptions): Menu | null {
  if (!devServerUrl) return null;

  const isMac = process.platform === 'darwin';
  const worktreeName = folderName(appPath);
  const port = devServerPort(devServerUrl);
  const devLabel = port ? `Dev instance: ${worktreeName} · :${port}` : `Dev instance: ${worktreeName}`;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: devLabel, enabled: false }],
    },
  ];

  return Menu.buildFromTemplate(template);
}
