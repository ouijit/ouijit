import { useState, useRef, useCallback, useEffect } from 'react';
import {
  DescriptionChipEditor,
  type DescriptionChipEditorHandle,
  type DescriptionEditorMetrics,
} from './DescriptionChipEditor';
import { TaskComposerSheet } from './TaskComposerSheet';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';
import { useAppStore } from '../../stores/appStore';
import { useComposerStore } from '../../stores/composerStore';
import { resolveAttachmentPath } from '../../utils/taskAttachments';
import { isModKey, MOD_LABEL } from '../../utils/modKey';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

/**
 * The description grows with its content up to this share of the column body,
 * then scrolls internally. Enough room for a real paragraph, few enough cards
 * hidden that you keep your place in the column.
 */
const DESCRIPTION_CAP_RATIO = 0.4;

/** Bounds for a height set by dragging the composer's top edge. */
const MIN_DRAG_HEIGHT = 72;
/** Cards that must stay visible above a dragged composer. Matches the card
 *  list's own min-height, which is what stops it absorbing the difference. */
const MIN_CARD_LIST_HEIGHT = 80;

/** Global setting holding the dragged height, so it survives restarts. */
const HEIGHT_SETTING_KEY = 'ui:composerDescriptionHeight';

const EMPTY_METRICS: DescriptionEditorMetrics = { overflowing: false, atTop: true, atBottom: true };

function SubmitHint({ withModifier }: { withModifier: boolean }) {
  return (
    <span className="kanban-add-button-hint">
      {withModifier && <Icon name={isMac ? 'command' : 'control'} className="kanban-add-button-hint-icon" />}
      <Icon name="arrow-elbow-down-left" className="kanban-add-button-hint-icon" />
    </span>
  );
}

interface KanbanAddInputProps {
  onAdd: (name: string, description?: string) => void;
}

/**
 * The new-task composer, pinned below the Todo column's card list.
 *
 * Three things make it work at any column length and any draft length:
 * it lives outside the column's scroll container, its description grows only
 * to a share of the column before scrolling internally, and at that point it
 * offers an expanded sheet holding the same draft. A draft is never discarded
 * implicitly — Escape collapses and keeps it.
 */
export function KanbanAddInput({ onAdd }: KanbanAddInputProps) {
  // The draft is shared with the standalone sheet, which opens on ⌘N when the
  // board isn't on screen, so it has to outlive this component.
  const name = useComposerStore((s) => s.draft.name);
  const description = useComposerStore((s) => s.draft.description);
  const sheetOpen = useComposerStore((s) => s.sheetOpen);
  const sheetCaret = useComposerStore((s) => s.sheetCaret);
  const setName = useComposerStore((s) => s.setName);
  const setDescription = useComposerStore((s) => s.setDescription);

  const [active, setActive] = useState(false);
  // Which input owns focus right now — drives the submit hint, since plain
  // Enter creates from the title field but the description needs ⌘/Ctrl+↵.
  const [focusedField, setFocusedField] = useState<'title' | 'description'>('title');
  const [metrics, setMetrics] = useState<DescriptionEditorMetrics>(EMPTY_METRICS);
  const [pinnedHeight, setPinnedHeight] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<DescriptionChipEditorHandle>(null);
  const formRef = useRef<HTMLDivElement>(null);
  /** Set when the form is opened from the collapsed row, consumed on mount. */
  const focusOnOpenRef = useRef(false);

  const hasDraft = name.trim().length > 0 || description.trim().length > 0;
  const canSubmit = name.trim().length > 0;

  // Restore the dragged height once; a missing or malformed value just means
  // the cap is in charge, which is the default anyway.
  useEffect(() => {
    let cancelled = false;
    void window.api.globalSettings.get(HEIGHT_SETTING_KEY).then((stored) => {
      const parsed = stored ? Number.parseInt(stored, 10) : NaN;
      if (!cancelled && Number.isFinite(parsed) && parsed >= MIN_DRAG_HEIGHT) setPinnedHeight(parsed);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The cap moved (drag, restore, or reset), so the fades and the promoted
  // expand affordance need re-measuring against the new box.
  useEffect(() => {
    editorRef.current?.refreshMetrics();
  }, [pinnedHeight, active]);

  // Let the board know the sheet owns Escape and ⌘N while it's up. Registered
  // only while open, so a component that never opens one can't clear the count.
  useEffect(() => {
    if (!sheetOpen) return;
    useAppStore.getState().openComposerSheet();
    return () => useAppStore.getState().closeComposerSheet();
  }, [sheetOpen]);

  const openForm = useCallback(() => {
    focusOnOpenRef.current = true;
    setActive(true);
  }, []);

  useEffect(() => {
    if (!active || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    inputRef.current?.focus();
  }, [active]);

  /** Close the form without touching the draft. */
  const collapse = useCallback(() => {
    setActive(false);
    setFocusedField('title');
  }, []);

  /** Throw the draft away and close. The only path that loses text. */
  const discard = useCallback(() => {
    const composer = useComposerStore.getState();
    composer.clearDraft();
    composer.closeSheet();
    editorRef.current?.setValue('');
    setActive(false);
    setFocusedField('title');
  }, []);

  const submit = useCallback(() => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedDescription = description.trim();
    onAdd(trimmedName, trimmedDescription || undefined);
    // Clear the fields but keep the form open and focused so the next task
    // can be typed immediately without clicking back in.
    const composer = useComposerStore.getState();
    composer.clearDraft();
    composer.closeSheet();
    editorRef.current?.setValue('');
    setActive(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [name, description, onAdd]);

  const expand = useCallback(() => {
    useComposerStore.getState().openSheet(editorRef.current?.getCaret() ?? null);
  }, []);

  /** Return from the sheet, putting the caret back where it was left. */
  const collapseSheet = useCallback((caret: number | null) => {
    useComposerStore.getState().closeSheet();
    setActive(true);
    requestAnimationFrame(() => {
      if (caret != null) editorRef.current?.focusAtCaret(caret);
      else inputRef.current?.focus();
    });
  }, []);

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isModKey(e) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        expand();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        collapse();
      }
      // Tab falls through to native focus handling, moving into the description field.
    },
    [submit, collapse, expand],
  );

  const handleDescriptionKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl+Enter submits; plain Enter falls through to contentEditable's
      // native line-break handling.
      if (isModKey(e) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        expand();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        collapse();
      }
    },
    [submit, collapse, expand],
  );

  const handleDescriptionFocus = useCallback(() => setFocusedField('description'), []);
  const handleNameFocus = useCallback(() => {
    setActive(true);
    setFocusedField('title');
  }, []);

  // Collapse only when focus leaves the whole form and nothing was entered.
  // With something in it the form stays open — the draft outlives a stray click.
  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      const nextFocus = e.relatedTarget as Node | null;
      if (nextFocus && e.currentTarget.contains(nextFocus)) return;
      if (sheetOpen) return;
      if (!hasDraft) setActive(false);
    },
    [hasDraft, sheetOpen],
  );

  // ── Drag the top edge to pin a height ──────────────────────────────
  const dragRef = useRef<{ startY: number; startHeight: number; max: number } | null>(null);

  const handleGripPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const editor = document.querySelector<HTMLElement>('.kanban-add-description');
    const form = formRef.current;
    if (!editor || !form) return;
    // The column publishes the room below its header as a custom property. That
    // span holds the card list *and* this composer, so the ceiling has to
    // subtract the composer's own chrome and the list's min-height — otherwise
    // the form grows past the column and the action row is clipped away.
    const bodyHeight = Number.parseFloat(getComputedStyle(form).getPropertyValue('--kanban-body-h')) || 0;
    const editorHeight = editor.getBoundingClientRect().height;
    const chrome = form.getBoundingClientRect().height - editorHeight;
    dragRef.current = {
      startY: e.clientY,
      startHeight: editorHeight,
      max: Math.max(MIN_DRAG_HEIGHT, bodyHeight - chrome - MIN_CARD_LIST_HEIGHT),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const handleGripPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging up (a smaller clientY) makes the composer taller.
    const next = drag.startHeight + (drag.startY - e.clientY);
    setPinnedHeight(Math.round(Math.min(drag.max, Math.max(MIN_DRAG_HEIGHT, next))));
  }, []);

  const handleGripPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (pinnedHeight != null) void window.api.globalSettings.set(HEIGHT_SETTING_KEY, String(pinnedHeight));
    },
    [pinnedHeight],
  );

  const resetHeight = useCallback(() => {
    setPinnedHeight(null);
    void window.api.globalSettings.set(HEIGHT_SETTING_KEY, '');
    editorRef.current?.focus();
  }, []);

  /** Which edges are hiding text, so the mask fades only those. */
  const clip = !metrics.overflowing ? 'none' : metrics.atTop ? 'bottom' : metrics.atBottom ? 'top' : 'both';

  const capStyle: React.CSSProperties =
    pinnedHeight != null
      ? { height: pinnedHeight, maxHeight: pinnedHeight }
      : { maxHeight: `calc(var(--kanban-body-h, 20rem) * ${DESCRIPTION_CAP_RATIO})` };

  return (
    <div ref={formRef} className="kanban-add-form" onBlur={handleBlur}>
      {!active && (
        <button
          type="button"
          className="kanban-add-rest"
          onClick={openForm}
          aria-label={hasDraft ? 'Resume draft task' : 'New task'}
        >
          {hasDraft ? (
            <>
              <Icon name="file-dashed" className="kanban-add-draft-icon" />
              <span className="kanban-add-draft-label">{name.trim() || 'Untitled draft'}</span>
            </>
          ) : (
            <>
              <span className="kanban-add-rest-plus">+</span>
              <span>New task</span>
              <span className="kanban-add-button-hint kanban-add-button-hint-text">{MOD_LABEL}N</span>
            </>
          )}
        </button>
      )}

      {active && (
        <>
          <div
            className="kanban-add-grip"
            title={pinnedHeight != null ? 'Drag to set the height, double-click to reset' : 'Drag to set the height'}
            onPointerDown={handleGripPointerDown}
            onPointerMove={handleGripPointerMove}
            onPointerUp={handleGripPointerUp}
            onPointerCancel={handleGripPointerUp}
            // Reset belongs to the control that set the height, rather than a
            // link in the footer that's only ever relevant after a drag.
            onDoubleClick={resetHeight}
          />
          <input
            ref={inputRef}
            type="text"
            className="kanban-add-input w-full text-[15px] text-text-primary bg-transparent px-3 py-3 outline-none transition-all duration-150 ease-out border-none focus:bg-ink/[0.04]"
            style={{ borderBottom: '1px solid color-mix(in srgb, var(--color-ink) 6%, transparent)' }}
            placeholder="New task..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onFocus={handleNameFocus}
          />
          <div className={`kanban-add-description-wrap${metrics.overflowing ? ' is-capped' : ''}`} data-clip={clip}>
            <DescriptionChipEditor
              ref={editorRef}
              // The editor mounts with the form, so a draft kept through a
              // collapse comes back with it. Uncontrolled from then on.
              initialValue={description}
              onChange={setDescription}
              onAttachFile={resolveAttachmentPath}
              onMetrics={setMetrics}
              placeholder="Description (optional)"
              onKeyDown={handleDescriptionKeyDown}
              onFocus={handleDescriptionFocus}
              className="kanban-add-description w-full text-sm leading-relaxed text-text-secondary bg-transparent px-3 py-2.5 outline-none transition-all duration-150 ease-out border-none focus:bg-ink/[0.04]"
              style={{
                minHeight: '4.5rem',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                overflowY: 'auto',
                ...capStyle,
              }}
            />
            {/* The tooltip carries the shortcut and, once the box is
                clipping, says what expanding buys you. */}
            <Tooltip
              placement="left"
              text={
                <span className="flex items-center gap-2">
                  {metrics.overflowing ? 'Expand to the full sheet' : 'Expand'}
                  <span className="kanban-add-button-hint kanban-add-button-hint-text">{MOD_LABEL}E</span>
                </span>
              }
              referenceClassName="kanban-add-expand-anchor"
            >
              <button
                type="button"
                className="kanban-add-expand"
                aria-label="Expand the description"
                // Keep focus in the editor so the caret is still readable when
                // the sheet asks for it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={expand}
              >
                <Icon name="arrows-out" className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>
          {/* DOM order is [Create, Discard] so Tab from the description lands
              on Create first; flex-row-reverse keeps Discard on the visual left.
              No bottom rule: this row is the column's bottom edge now. */}
          <div className="flex flex-row-reverse items-center justify-start gap-2 px-2 py-1.5">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="kanban-add-button text-accent hover:bg-accent/10 disabled:text-text-tertiary"
            >
              Create
              <SubmitHint withModifier={focusedField === 'description'} />
            </button>
            <button
              type="button"
              onClick={discard}
              className="kanban-add-button text-text-tertiary hover:text-text-primary hover:bg-ink/[0.04]"
            >
              Discard
            </button>
          </div>
        </>
      )}

      {sheetOpen && (
        <TaskComposerSheet
          mode="create"
          name={name}
          description={description}
          initialCaret={sheetCaret}
          onNameChange={setName}
          onDescriptionChange={(value) => {
            setDescription(value);
            // Mirror into the inline editor behind the scrim, so collapsing
            // returns to the same draft rather than a stale one.
            editorRef.current?.setValue(value);
          }}
          onAttachFile={resolveAttachmentPath}
          onSubmit={submit}
          onCollapse={collapseSheet}
          onDiscard={discard}
        />
      )}
    </div>
  );
}

/** Focus the kanban add input programmatically, opening the form if collapsed */
export function focusKanbanAddInput(): void {
  // The expanded sheet holds the same draft and already has focus; pulling it
  // back to the input behind the scrim would strand the caret.
  if (useAppStore.getState().composerSheetCount > 0) return;

  const input = document.querySelector<HTMLInputElement>('.kanban-add-input');
  if (input) {
    input.focus();
    return;
  }
  // Collapsed: the click handler opens the form, which focuses the title.
  document.querySelector<HTMLButtonElement>('.kanban-add-rest')?.click();
}
