import type { DiffNote } from '../../diffNotes';
import { formatNotesForAgent } from '../../diffNotes';
import { describeLines } from '../../diffAnchor';
import { useProjectStore } from '../../stores/projectStore';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';
import { PendingRow } from '../ui/PendingRow';
import { ActionMenu } from '../ui/ActionMenu';
import { MenuDivider, MenuItem } from '../ui/Menu';
import { SegmentedGroup, segmentBase, segmentQuiet } from '../ui/SegmentedGroup';

interface DiffNotesIslandProps {
  notes: DiffNote[];
  /**
   * Notes whose lines appear in the comparison being viewed. The rest are still
   * listed and handed over, but have nothing to jump to.
   */
  inView: ReadonlySet<string>;
  /** The comparison these were written on, used as the heading for the agent. */
  subject: string;
  ptyId: string;
  onJump: (note: DiffNote) => void;
  onDiscard: (id: string) => Promise<void>;
  onClear: () => Promise<void>;
}

/**
 * Wrapped in bracketed-paste markers: without them the terminal reads each
 * newline as Enter and submits a multi-line note partway through. Nothing
 * follows the closing marker, so the text sits in the prompt unsent.
 */
function pasteIntoTerminal(ptyId: string, text: string): void {
  window.api.pty.write(ptyId, `\x1b[200~${text}\x1b[201~`);
}

/** The notes written on this diff, and the two ways to hand them over. */
export function DiffNotesIsland({ notes, inView, subject, ptyId, onJump, onDiscard, onClear }: DiffNotesIslandProps) {
  if (notes.length === 0) return null;

  // On demand, not per render: it walks every note and nothing displays it.
  const forAgent = () => formatNotesForAgent(notes, subject);

  const copy = () => {
    void navigator.clipboard.writeText(forAgent()).then(
      () => useProjectStore.getState().addToast(`${notes.length} copied`, 'success'),
      () => useProjectStore.getState().addToast('Could not copy the notes', 'error'),
    );
  };

  return (
    // Only the capsule takes pointer events, so the pane behind stays scrollable.
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100%-2rem)] pointer-events-none">
      <div className="pointer-events-auto">
        <SegmentedGroup floating>
          <ActionMenu label={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`} dot placement="top-start">
            {(close) => (
              <>
                {notes.map((note) => (
                  <PendingRow
                    key={note.id}
                    path={note.path}
                    line={describeLines(note.startLine, note.line)}
                    body={note.body}
                    discardTitle="Discard this note"
                    badge={
                      inView.has(note.id) ? undefined : (
                        <span className="shrink-0 px-1 rounded bg-ink/[0.08] text-text-secondary">
                          not in this comparison
                        </span>
                      )
                    }
                    onJump={() => {
                      if (!inView.has(note.id)) return;
                      close();
                      onJump(note);
                    }}
                    onDiscard={() => void onDiscard(note.id)}
                  />
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

          <Tooltip text="Copy" placement="top" referenceClassName="inline-flex h-full">
            <button
              type="button"
              aria-label="Copy"
              className={`${segmentBase} ${segmentQuiet} [&>svg]:w-3.5 [&>svg]:h-3.5`}
              onClick={copy}
            >
              <Icon name="copy" />
            </button>
          </Tooltip>

          {/* The agent these are meant for is the terminal this panel is split
              against. */}
          <Tooltip text="Send" placement="top" referenceClassName="inline-flex h-full">
            <button
              type="button"
              aria-label="Send"
              className={`${segmentBase} ${segmentQuiet} [&>svg]:w-3.5 [&>svg]:h-3.5`}
              onClick={() => pasteIntoTerminal(ptyId, forAgent())}
            >
              <Icon name="terminal" />
            </button>
          </Tooltip>
        </SegmentedGroup>
      </div>
    </div>
  );
}
