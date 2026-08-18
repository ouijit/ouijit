import { typedHandle } from '../helpers';
import { liveNotes, saveNote, discardNote, clearNotes } from '../../diffNotesService';

export function registerDiffPanelHandlers(): void {
  typedHandle('diff-notes:list', (worktreePath, keep) => liveNotes(worktreePath, keep));
  typedHandle('diff-notes:save', (input) => saveNote(input));
  typedHandle('diff-notes:discard', (id) => discardNote(id));
  typedHandle('diff-notes:clear', (worktreePath) => clearNotes(worktreePath));
}
