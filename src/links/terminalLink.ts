import log from 'electron-log/renderer';
import { openFileInEditor } from '../services/openInEditor';
import { openLink } from './openLink';

const linkLog = log.scope('links');

/**
 * Where a link clicked in a terminal goes. `file://` opens in the project's
 * editor; any other scheme a program wrote is ignored, since the terminal's
 * output is not ours to trust.
 */
export async function openTerminalLink(uri: string, projectPath: string, workspaceRoot: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    linkLog.warn('malformed terminal link', { uri });
    return;
  }
  switch (url.protocol) {
    case 'ouijit:':
      return openLink(uri);
    case 'http:':
    case 'https:':
      return window.api.openExternal(uri);
    case 'file:':
      return openFileInEditor(projectPath, workspaceRoot, decodeURIComponent(url.pathname));
    default:
      linkLog.warn('ignored terminal link', { scheme: url.protocol });
  }
}
