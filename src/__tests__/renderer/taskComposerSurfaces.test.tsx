/**
 * The composer's other two surfaces, and the placement the whole design rests
 * on.
 *
 * `kanbanAddInput.test.tsx` covers the column composer. This covers what it
 * hands off to: the standalone sheet that ⌘N opens away from the board, the
 * card's sheet for editing an existing description, and the requirement that
 * the composer sits outside the column's scroll container.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { KanbanColumnView } from '../../components/kanban/KanbanColumnView';
import { KanbanCardView } from '../../components/kanban/KanbanCardView';
import { StandaloneComposerSheet } from '../../components/kanban/StandaloneComposerSheet';
import { useComposerStore } from '../../stores/composerStore';
import { useAppStore } from '../../stores/appStore';
import { useProjectStore } from '../../stores/projectStore';
import type { TaskWithWorkspace } from '../../types';

/** The platform modifier the app binds to, mirrored so these run on any host. */
const MOD = navigator.platform.toLowerCase().includes('mac') ? { metaKey: true } : { ctrlKey: true };

const getSheet = () => screen.queryByTestId('composer-sheet');
const getSheetEditor = () => getSheet()?.querySelector('.composer-sheet-editor') as HTMLDivElement | undefined;
const getSheetName = () => getSheet()?.querySelector('textarea') as HTMLTextAreaElement | undefined;

/** Set a contentEditable's text and fire the input event the editor listens for. */
function typeInto(el: HTMLElement, text: string): void {
  el.innerHTML = '';
  if (text) el.appendChild(document.createTextNode(text));
  fireEvent.input(el);
}

/** The sheet plays its exit before handing control back. */
async function flushSheetExit(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

beforeEach(() => {
  useComposerStore.setState({ draft: { name: '', description: '' }, sheetOpen: false, sheetCaret: null });
  useAppStore.setState({ composerSheetCount: 0 });
  // Off the board, which is when the standalone sheet is the one that renders.
  useProjectStore.setState({ activePanel: 'terminals', kanbanVisible: false });
});

describe('column placement', () => {
  it('keeps the footer out of the scrolling card list', () => {
    const { container } = render(
      <KanbanColumnView status="todo" label="Todo" count={0} footer={<div data-testid="composer" />}>
        <div data-testid="card" />
      </KanbanColumnView>,
    );

    const body = container.querySelector('.kanban-column-body')!;
    expect(body.contains(screen.getByTestId('card'))).toBe(true);
    // Outside the scrolling body, so column length cannot push it out of view.
    expect(body.contains(screen.getByTestId('composer'))).toBe(false);
  });
});

describe('StandaloneComposerSheet', () => {
  it('stays closed until the sheet is opened away from the board', () => {
    const { rerender } = render(<StandaloneComposerSheet projectPath="/p" />);
    expect(getSheet()).toBeNull();

    act(() => useComposerStore.getState().openSheet());
    rerender(<StandaloneComposerSheet projectPath="/p" />);
    expect(getSheet()).not.toBeNull();

    // On the board the column composer owns the sheet, so this one stands down
    // and the two can never both render it.
    act(() => useProjectStore.setState({ kanbanVisible: true }));
    rerender(<StandaloneComposerSheet projectPath="/p" />);
    expect(getSheet()).toBeNull();
  });

  it('creates the task through the API and clears the draft', async () => {
    const create = vi.spyOn(window.api.task, 'create').mockResolvedValue({ success: true } as never);
    act(() => useComposerStore.getState().openSheet());
    render(<StandaloneComposerSheet projectPath="/p" />);

    fireEvent.change(getSheetName()!, { target: { value: 'Fix login' } });
    typeInto(getSheetEditor()!, 'Session expires after 30s');
    fireEvent.keyDown(document, { key: 'Enter', ...MOD });
    await flushSheetExit();

    expect(create).toHaveBeenCalledWith('/p', 'Fix login', 'Session expires after 30s');
    expect(useComposerStore.getState().draft).toEqual({ name: '', description: '' });
    expect(getSheet()).toBeNull();
    create.mockRestore();
  });

  it('creates once when the submit shortcut repeats', async () => {
    const create = vi.spyOn(window.api.task, 'create').mockResolvedValue({ success: true } as never);
    act(() => useComposerStore.getState().openSheet());
    render(<StandaloneComposerSheet projectPath="/p" />);
    fireEvent.change(getSheetName()!, { target: { value: 'Fix login' } });

    // The submit is deferred behind the exit transition, so without a latch a
    // held key queues one timer per repeat and each creates the task again.
    fireEvent.keyDown(document, { key: 'Enter', ...MOD });
    fireEvent.keyDown(document, { key: 'Enter', ...MOD });
    fireEvent.keyDown(document, { key: 'Enter', ...MOD, repeat: true });
    await flushSheetExit();

    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
  });

  it('keeps the draft when collapsed, and drops it only on discard', async () => {
    act(() => useComposerStore.getState().openSheet());
    render(<StandaloneComposerSheet projectPath="/p" />);

    fireEvent.change(getSheetName()!, { target: { value: 'Half written' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    await flushSheetExit();
    expect(useComposerStore.getState().draft.name).toBe('Half written');

    act(() => useComposerStore.getState().openSheet());
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(useComposerStore.getState().draft.name).toBe('');
  });
});

describe("the card's description sheet", () => {
  const task = {
    taskNumber: 7,
    name: 'fix(pty): scrollback lost on reconnect',
    status: 'todo',
    prompt: 'Started on the card',
  } as TaskWithWorkspace;

  /** Expand the card, then click the description to start editing it. */
  function openCardEditor(): HTMLElement {
    const caret = document.querySelector('.kanban-card button')! as HTMLButtonElement;
    fireEvent.click(caret);
    const editor = document.querySelector('.kanban-description-editor') as HTMLElement;
    fireEvent.click(editor);
    return document.querySelector('.kanban-description-editor') as HTMLElement;
  }

  it('carries the card description into the sheet and saves what was written there', async () => {
    const onUpdateDescription = vi.fn();
    const { container } = render(<KanbanCardView task={task} onUpdateDescription={onUpdateDescription} />);

    const editor = openCardEditor();
    expect(editor.textContent).toBe('Started on the card');

    fireEvent.keyDown(editor, { key: 'e', ...MOD });
    expect(getSheetEditor()!.textContent).toBe('Started on the card');

    // Editing in the sheet mirrors back into the card underneath, which is what
    // makes saving read the right value from one place.
    typeInto(getSheetEditor()!, 'Rewritten with room to think');
    expect(container.querySelector('.kanban-description-editor')!.textContent).toBe('Rewritten with room to think');

    fireEvent.keyDown(document, { key: 'Enter', ...MOD });
    await flushSheetExit();
    expect(onUpdateDescription).toHaveBeenCalledWith(7, 'Rewritten with room to think');
    expect(getSheet()).toBeNull();
  });

  it('does not commit the description when the sheet takes focus', () => {
    const onUpdateDescription = vi.fn();
    render(<KanbanCardView task={task} onUpdateDescription={onUpdateDescription} />);

    const editor = openCardEditor();
    fireEvent.keyDown(editor, { key: 'e', ...MOD });

    // Opening the sheet moves focus to its editor, which blurs this one. A
    // blur commit there would write the description out and drop the card's
    // editor back to read-only underneath the sheet.
    fireEvent.blur(editor);
    expect(onUpdateDescription).not.toHaveBeenCalled();
  });

  it('tells the board to leave Escape alone while the sheet is up', async () => {
    render(<KanbanCardView task={task} onUpdateDescription={vi.fn()} />);

    fireEvent.keyDown(openCardEditor(), { key: 'e', ...MOD });
    expect(useAppStore.getState().composerSheetCount).toBe(1);

    fireEvent.keyDown(document, { key: 'Escape' });
    await flushSheetExit();
    expect(useAppStore.getState().composerSheetCount).toBe(0);
  });
});
