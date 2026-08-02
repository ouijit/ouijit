/**
 * Behavior tests for the new-task composer.
 *
 * The composer rests as a single row below the column's card list and opens
 * into a title plus description. Two properties matter most and are covered
 * here: a draft is never lost implicitly (Escape collapses and keeps it, only
 * an explicit discard clears it), and the draft is one piece of state shared
 * by the inline form and the expanded sheet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { KanbanAddInput, focusKanbanAddInput } from '../../components/kanban/KanbanAddInput';

const getRest = () => document.querySelector('.kanban-add-rest') as HTMLButtonElement | null;
const getTitle = () => document.querySelector('.kanban-add-input') as HTMLInputElement | null;
/** Description is a contentEditable div — query by its stable class. */
const getDescription = () => document.querySelector('.kanban-add-description') as HTMLDivElement | null;
const getSheet = () => screen.queryByTestId('composer-sheet');
const getSheetDescription = () => getSheet()?.querySelector('.composer-sheet-editor') as HTMLDivElement | undefined;
const getCreateButton = () => screen.queryByRole('button', { name: /^Create/ }) as HTMLButtonElement | null;

/** Open the resting composer and return its title input. */
function openComposer(): HTMLInputElement {
  fireEvent.click(getRest()!);
  return getTitle()!;
}

/** Set the editor's text content and fire the input event the editor listens
 *  for. Mirrors what a user typing produces, minus chip insertion. */
function typeInto(el: HTMLElement, text: string): void {
  el.innerHTML = '';
  if (text) el.appendChild(document.createTextNode(text));
  fireEvent.input(el);
}

/** The sheet plays its exit before handing control back, like the app's other
 *  overlays, so anything it hands off lands a transition later. */
async function flushSheetExit(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
}

/** Swap in a partial window.api for one test, restoring it afterwards. */
let restoreApi: (() => void) | null = null;
function stubApi(overrides: Record<string, unknown>): void {
  const original = window.api;
  Object.defineProperty(window, 'api', { value: { ...original, ...overrides }, writable: true });
  restoreApi = () => Object.defineProperty(window, 'api', { value: original, writable: true });
}
afterEach(() => {
  restoreApi?.();
  restoreApi = null;
});

describe('KanbanAddInput', () => {
  it('rests as a single row and opens on click', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    expect(getRest()).not.toBeNull();
    expect(getTitle()).toBeNull();
    expect(getDescription()).toBeNull();

    const title = openComposer();
    expect(title).not.toBeNull();
    expect(getDescription()).not.toBeNull();
    expect(document.activeElement).toBe(title);
  });

  it('creates from the title alone and stays open for the next task', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'First task' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenNthCalledWith(1, 'First task', undefined);
    expect(getTitle()!.value).toBe('');

    fireEvent.change(getTitle()!, { target: { value: 'Second task' } });
    fireEvent.keyDown(getTitle()!, { key: 'Enter' });
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Second task', undefined);
  });

  it('creates with a description on Cmd+Enter, and omits a blank one', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    typeInto(getDescription()!, 'Session expires after 30s');
    fireEvent.keyDown(getDescription()!, { key: 'Enter', metaKey: true });
    expect(onAdd).toHaveBeenNthCalledWith(1, 'Fix login', 'Session expires after 30s');

    fireEvent.change(getTitle()!, { target: { value: 'Second' } });
    typeInto(getDescription()!, '   ');
    fireEvent.keyDown(getTitle()!, { key: 'Enter' });
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Second', undefined);
  });

  it('disables Create until the title has content', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = openComposer();
    expect(getCreateButton()!.disabled).toBe(true);

    fireEvent.change(title, { target: { value: 'Fix login' } });
    expect(getCreateButton()!.disabled).toBe(false);

    fireEvent.change(title, { target: { value: '   ' } });
    expect(getCreateButton()!.disabled).toBe(true);
  });

  it('keeps the draft when Escape collapses the form, and restores it on reopen', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    typeInto(getDescription()!, 'Long prompt worth keeping');
    fireEvent.keyDown(getDescription()!, { key: 'Escape' });

    // Collapsed, but advertising the pending draft rather than looking empty.
    expect(getTitle()).toBeNull();
    expect(getRest()!.textContent).toContain('Fix login');

    const reopened = openComposer();
    expect(reopened.value).toBe('Fix login');
    expect(getDescription()!.textContent).toBe('Long prompt worth keeping');
  });

  it('discards the draft on a second Escape, and from the Discard button', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.keyDown(title, { key: 'Escape' });
    fireEvent.keyDown(getRest()!, { key: 'Escape' });

    expect(getRest()!.textContent).toContain('New task');
    expect(openComposer().value).toBe('');

    fireEvent.change(getTitle()!, { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(getTitle()).toBeNull();
    expect(getRest()!.textContent).toContain('New task');
  });

  it('shares one draft between the inline form and the expanded sheet', async () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    typeInto(getDescription()!, 'Started inline');
    fireEvent.keyDown(getDescription()!, { key: 'e', metaKey: true });

    // The sheet opens on the same draft.
    expect(getSheet()).not.toBeNull();
    expect(getSheetDescription()!.textContent).toBe('Started inline');

    // Editing in the sheet mirrors back into the inline editor behind it.
    typeInto(getSheetDescription()!, 'Continued in the sheet');
    expect(getDescription()!.textContent).toBe('Continued in the sheet');

    // Escape returns to the column with the draft intact, not to a cleared form.
    fireEvent.keyDown(document, { key: 'Escape' });
    await flushSheetExit();
    expect(getSheet()).toBeNull();
    expect(getTitle()!.value).toBe('Fix login');
    expect(getDescription()!.textContent).toBe('Continued in the sheet');
  });

  it('creates from the sheet and closes it', async () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = openComposer();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.keyDown(title, { key: 'e', metaKey: true });
    typeInto(getSheetDescription()!, 'Written with room to think');
    fireEvent.keyDown(document, { key: 'Enter', metaKey: true });
    await flushSheetExit();

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Written with room to think');
    expect(getSheet()).toBeNull();
    expect(getTitle()!.value).toBe('');
  });

  it('opens the collapsed form when focused programmatically', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    expect(getTitle()).toBeNull();
    // Called from a document-level hotkey in the app, so it isn't a React
    // event; act() stands in for the flush React does before the next paint.
    act(() => focusKanbanAddInput());
    expect(document.activeElement).toBe(getTitle());
  });

  it('saves an image attachment from clipboard paste with no source path', async () => {
    const onAdd = vi.fn();
    const saveAttachment = vi.fn().mockResolvedValue({ success: true, path: '/tmp/img-test.png' });
    const getPathForFile = vi.fn().mockReturnValue('');
    stubApi({ task: { ...window.api.task, saveAttachment }, getPathForFile });

    render(<KanbanAddInput onAdd={onAdd} />);
    const title = openComposer();
    fireEvent.change(title, { target: { value: 'With image' } });

    const editor = getDescription()!;
    const file = new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' });
    const dataTransfer = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer;
    fireEvent.paste(editor, { clipboardData: dataTransfer });
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(getPathForFile).toHaveBeenCalledTimes(1);
    expect(saveAttachment).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('With image', '![](/tmp/img-test.png)');
  });

  it('uses the original file path on drop, with no copy and any extension', async () => {
    const onAdd = vi.fn();
    const saveAttachment = vi.fn().mockResolvedValue({ success: false, error: 'should not be called' });
    const getPathForFile = vi.fn().mockReturnValue('/Users/me/notes/agenda.txt');
    stubApi({ task: { ...window.api.task, saveAttachment }, getPathForFile });

    render(<KanbanAddInput onAdd={onAdd} />);
    const title = openComposer();
    fireEvent.change(title, { target: { value: 'With file' } });

    const editor = getDescription()!;
    const file = new File([new Uint8Array([1])], 'agenda.txt', { type: 'text/plain' });
    const dataTransfer = {
      items: [{ kind: 'file', type: 'text/plain' }],
      files: [file],
    } as unknown as DataTransfer;
    fireEvent.drop(editor, { dataTransfer, clientX: 0, clientY: 0 });
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    expect(getPathForFile).toHaveBeenCalledTimes(1);
    expect(saveAttachment).not.toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalledWith('With file', '![](/Users/me/notes/agenda.txt)');
  });
});
