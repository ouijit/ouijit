type TerminalLinkOpener = (uri: string, projectPath: string, workspaceRoot: string) => Promise<void>;

let opener: TerminalLinkOpener | null = null;

/**
 * Set once by the renderer entry. Opening a link can spawn a terminal, so the
 * terminal cannot import what opens its links.
 */
export function setTerminalLinkOpener(open: TerminalLinkOpener): void {
  opener = open;
}

export function openLinkFromTerminal(uri: string, projectPath: string, workspaceRoot: string): Promise<void> {
  return opener ? opener(uri, projectPath, workspaceRoot) : Promise.resolve();
}
