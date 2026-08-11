import type { DiffNote, DiffNoteMode } from '../../diffNotes';
import { formatNotesForAgent } from '../../diffNotes';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';
import { ActionMenu } from '../ui/ActionMenu';
import { MenuDivider, MenuItem } from '../ui/Menu';
import { SegmentedGroup, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';

interface DiffNotesIslandProps {
  notes: DiffNote[];
  mode: DiffNoteMode;
  /** The terminal the notes are about, and the one they are handed to. */
  ptyId: string;
  onJump: (note: DiffNote) => void;
  onDiscard: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * Write the notes into the terminal as a paste rather than as typing.
 *
 * The bracketed-paste markers are what a terminal emulator wraps a real paste
 * in; without them a newline is the Enter key and a three-line note submits
 * itself a third of the way through. Nothing follows the closing marker, so the
 * text sits in the agent's prompt unsent.
 */
function pasteIntoTerminal(ptyId: string, text: string): void {
  window.api.pty.write(ptyId, `\x1b[200~${text}\x1b[201~`);
}

/**
 * The notes written on this diff, and the two ways to hand them over.
 *
 * The same joined capsule and count-and-list segment the pull request's review
 * bar uses for unsent comments, since it is the same state. It sits over the
 * foot of the pane rather than in the header because notes are written while
 * scrolling, and it is only mounted while there are notes to show.
 */
export function DiffNotesIsland({ notes, mode, ptyId, onJump, onDiscard, onClear }: DiffNotesIslandProps) {
  if (notes.length === 0) return null;

  const text = formatNotesForAgent(notes, mode);

  const copy = () => {
    void navigator.clipboard.writeText(text).then(
      () => useProjectStore.getState().addToast(`${notes.length} copied`, 'success'),
      () => useProjectStore.getState().addToast('Could not copy the notes', 'error'),
    );
  };

  return (
    // Inset from the foot of the pane and centred on the diff column. Only the
    // capsule takes pointer events, so the well behind it stays scrollable.
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100%-2rem)] pointer-events-none">
      <div className="pointer-events-auto">
        <SegmentedGroup floating>
          <ActionMenu label={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`} dot placement="top-start">
            {(close) => (
              <>
                {notes.map((note) => (
                  <div key={note.id} className="group flex items-start gap-1">
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left px-2.5 py-1.5 rounded-[7px] hover:bg-ink/[0.08]"
                      onClick={() => {
                        close();
                        onJump(note);
                      }}
                    >
                      <span className="block font-mono text-[11px] text-text-tertiary truncate">
                        {note.path}:{note.line}
                      </span>
                      <span className="block text-[13px] text-text-secondary truncate">{note.body}</span>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 w-6 h-6 mt-1.5 rounded flex items-center justify-center text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity duration-100"
                      title="Discard this note"
                      onClick={() => void onDiscard(note.id)}
                    >
                      <Icon name="x" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <MenuDivider />
                <MenuItem
                  label="Discard all"
                  onClick={() => {
                    close();
                    void onClear();
                  }}
                />
              </>
            )}
          </ActionMenu>

          <Tooltip text="Copy for the agent" placement="top" referenceClassName="inline-flex h-full">
            <button
              type="button"
              aria-label="Copy for the agent"
              className={`${segmentBase} ${segmentQuiet} [&>svg]:w-3.5 [&>svg]:h-3.5`}
              onClick={copy}
            >
              <Icon name="copy" />
            </button>
          </Tooltip>

          {/* The direct route: the agent these are meant for is the terminal
              this panel is split against. */}
          <Tooltip text="Paste into the terminal" placement="top" referenceClassName="inline-flex h-full">
            <button
              type="button"
              aria-label="Paste into the terminal"
              className={`${segmentBase} ${segmentQuiet} [&>svg]:w-3.5 [&>svg]:h-3.5`}
              onClick={() => pasteIntoTerminal(ptyId, text)}
            >
              <Icon name="terminal" />
            </button>
          </Tooltip>
        </SegmentedGroup>
      </div>
    </div>
  );
}
