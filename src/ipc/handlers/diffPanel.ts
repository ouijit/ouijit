import type { BrowserWindow } from 'electron';
import { typedHandle, typedPush } from '../helpers';
import { listNotes, saveNote, discardNote, clearNotes } from '../../diffNotesService';
import { readDiffLens, writeDiffLens } from '../../diffLens';
import { listLenses, saveLens, deleteLens, getLensAgentChoice, setLensAgentChoice } from '../../lens/config';

export function registerDiffPanelHandlers(mainWindow: BrowserWindow): void {
  typedHandle('diff-notes:list', (worktreePath) => listNotes(worktreePath));
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
    // `saveLens` has already followed the rename through the stored groupings,
    // so anything reading one is one local row behind and nothing more. Told
    // here rather than by the settings panel reaching into whichever surfaces
    // it can currently see — that list only ever grows, and was already short.
    if (previousName && previousName !== lens.name) {
      typedPush(mainWindow, 'lens:renamed', { projectPath, from: previousName, to: lens.name });
    }
    return lens;
  });
  typedHandle('lens:delete', (projectPath, name) => deleteLens(projectPath, name));
  typedHandle('lens:agent', (projectPath) => getLensAgentChoice(projectPath));
  typedHandle('lens:set-agent', (projectPath, choice) => setLensAgentChoice(projectPath, choice));
}
