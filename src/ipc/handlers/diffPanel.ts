import { typedHandle } from '../helpers';
import { listNotes, saveNote, discardNote, clearNotes } from '../../diffNotesService';
import { readDiffLens, writeDiffLens } from '../../diffLens';

export function registerDiffPanelHandlers(): void {
  typedHandle('diff-notes:list', (worktreePath) => listNotes(worktreePath));
  typedHandle('diff-notes:save', (input) => saveNote(input));
  typedHandle('diff-notes:discard', (id) => discardNote(id));
  typedHandle('diff-notes:clear', (worktreePath) => clearNotes(worktreePath));

  typedHandle('diff-lens:get', (target) => readDiffLens(target));
  typedHandle('diff-lens:run', (target, lensName) => writeDiffLens(target, lensName));
}
