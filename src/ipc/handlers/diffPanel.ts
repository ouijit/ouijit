import { typedHandle } from '../helpers';
import { listNotes, saveNote, discardNote, clearNotes } from '../../diffNotesService';
import { readDiffLens, writeDiffLens } from '../../diffLens';
import { listLenses, getLensAgentChoice, setLensAgentChoice } from '../../lens/config';
import { saveLens, deleteLens } from '../../github/service';

export function registerDiffPanelHandlers(): void {
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
  typedHandle('lens:save', (projectPath, name, command, previousName) =>
    saveLens(projectPath, name, command, previousName),
  );
  typedHandle('lens:delete', (projectPath, name) => deleteLens(projectPath, name));
  typedHandle('lens:agent', (projectPath) => getLensAgentChoice(projectPath));
  typedHandle('lens:set-agent', (projectPath, choice) => setLensAgentChoice(projectPath, choice));
}
