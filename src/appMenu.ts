import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { folderName } from './utils/folderName';
import { DOCS_URL, ISSUES_URL } from './constants/links';

interface AppMenuOptions {
  /** Vite dev-server URL — truthy only in dev (`npm start`), undefined in packaged builds. */
  devServerUrl: string | undefined;
  /** Repo/worktree root, used to derive the dev-instance label. */
  appPath: string;
  onShowAbout: () => void;
}

function devServerPort(devServerUrl: string): string {
  try {
    return new URL(devServerUrl).port;
  } catch {
    return '';
  }
}

function devInstanceItem({ devServerUrl, appPath }: AppMenuOptions): MenuItemConstructorOptions[] {
  if (!devServerUrl) return [];
  const port = devServerPort(devServerUrl);
  const worktreeName = folderName(appPath);
  const label = port ? `Dev instance: ${worktreeName} · :${port}` : `Dev instance: ${worktreeName}`;
  return [{ type: 'separator' }, { label, enabled: false }];
}

/**
 * Replaces Electron's default menu outright, so the roles below are what keeps
 * copy/paste, DevTools and the rest of the defaults available.
 */
export function buildAppMenu(options: AppMenuOptions): Menu {
  const isMac = process.platform === 'darwin';
  const aboutItem: MenuItemConstructorOptions = { label: `About ${app.name}`, click: options.onShowAbout };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              aboutItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal(DOCS_URL) },
        { label: 'Report an Issue', click: () => shell.openExternal(ISSUES_URL) },
        ...(isMac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, aboutItem]),
        ...devInstanceItem(options),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
