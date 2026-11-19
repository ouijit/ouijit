import log from 'electron-log/renderer';
import { openFileInEditor } from '../services/openInEditor';
import { openLink } from './openLink';

const linkLog = log.scope('links');

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
      return openFile(url, projectPath, workspaceRoot);
    default:
      // A program in the terminal wrote this link, so an unknown scheme is not ours to open.
      linkLog.warn('ignored terminal link', { scheme: url.protocol });
  }
}

async function openFile(url: URL, projectPath: string, workspaceRoot: string): Promise<void> {
  let filePath: string;
  try {
    filePath = decodeURIComponent(url.pathname);
  } catch {
    linkLog.warn('malformed terminal link', { uri: url.href });
    return;
  }
  // kitty's convention, which ripgrep's `kitty` hyperlink format writes: a fragment of digits is a line.
  const line = /^#(\d+)$/.exec(url.hash)?.[1];
  return openFileInEditor(projectPath, workspaceRoot, filePath, line ? Number(line) : undefined);
}
