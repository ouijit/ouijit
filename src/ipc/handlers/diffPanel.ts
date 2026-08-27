import type { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { liveNotes, saveNote, discardNote, clearNotes } from '../../diffNotesService';
import { readDiffLens, writeDiffLens } from '../../lens/worktreeSubject';
import { listLenses, saveLens, deleteLens, getLensAgentChoice, setLensAgentChoice } from '../../lens/config';

export function registerDiffPanelHandlers(mainWindow: BrowserWindow): void {
  typedHandle('diff-notes:list', (worktreePath, keep) => liveNotes(worktreePath, keep));
  typedHandle('diff-notes:save', (input) => saveNote(input));
  typedHandle('diff-notes:discard', (id) => discardNote(id));
  typedHandle('diff-notes:clear', (worktreePath) => clearNotes(worktreePath));

  typedHandle('diff-lens:get', (target) => readDiffLens(target));
  typedHandle('diff-lens:run', (target, lensName) => writeDiffLens(target, lensName));

  // The project's lens list and agent, which both diffs read. Registered here
  // rather than among the GitHub handlers, which all require a repo identity
  // this does not need.
  typedHandle('lens:list', (projectPath) => listLenses(projectPath));
  typedHandle('lens:save', async (projectPath, name, command, previousName) => {
    const lens = await saveLens(projectPath, name, command, previousName);
    // `saveLens` follows the rename through the stored groupings, so anything
    // showing one is a single local row out of date. Broadcast rather than
    // patched in by the settings panel, which would have to know every surface
    // currently displaying a lens.
    if (previousName && previousName !== lens.name) {
      typedPush(mainWindow, 'lens:renamed', { projectPath, from: previousName, to: lens.name });
    }
    typedPush(mainWindow, 'lens:list-changed', projectPath);
    return lens;
  });
  typedHandle('lens:delete', async (projectPath, name) => {
    const result = await deleteLens(projectPath, name);
    typedPush(mainWindow, 'lens:list-changed', projectPath);
    return result;
  });
  typedHandle('lens:agent', (projectPath) => getLensAgentChoice(projectPath));
  typedHandle('lens:set-agent', (projectPath, choice) => setLensAgentChoice(projectPath, choice));
}
