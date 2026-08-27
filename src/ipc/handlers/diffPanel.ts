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
  typedHandle('diff-lens:run', (target, lensId) => writeDiffLens(target, lensId));

  // The project's lens list and agent, which both diffs read. Registered here
  // rather than among the GitHub handlers, which all require a repo identity
  // this does not need.
  typedHandle('lens:list', (projectPath) => listLenses(projectPath));
  typedHandle('lens:save', async (projectPath, input) => {
    const lens = await saveLens(projectPath, input);
    typedPush(mainWindow, 'lens:list-changed', projectPath);
    return lens;
  });
  typedHandle('lens:delete', async (projectPath, lensId) => {
    const result = await deleteLens(projectPath, lensId);
    typedPush(mainWindow, 'lens:list-changed', projectPath);
    return result;
  });
  typedHandle('lens:agent', (projectPath) => getLensAgentChoice(projectPath));
  typedHandle('lens:set-agent', (projectPath, choice) => setLensAgentChoice(projectPath, choice));
}
