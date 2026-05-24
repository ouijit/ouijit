/**
 * Behavior tests for the kanban add form. Users can enter a short title and,
 * by tabbing into the revealed description field, a full prompt before the
 * task is created. A Create button is the primary, always-visible action.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { KanbanAddInput } from '../../components/kanban/KanbanAddInput';

const getTitle = () => screen.getByPlaceholderText('New task...') as HTMLInputElement;
/** Description is a contentEditable div — query by its stable class. */
const getDescription = () => document.querySelector('.kanban-add-description') as HTMLDivElement | null;
const getCreateButton = () => screen.queryByRole('button', { name: 'Create' }) as HTMLButtonElement | null;
const getCancelButton = () => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

/** Set the editor's text content and fire the input event the editor listens
 *  for. Mirrors what a user typing produces, minus chip insertion. */
function typeDescription(text: string): void {
  const el = getDescription();
  if (!el) throw new Error('Description editor not in DOM');
  el.innerHTML = '';
  if (text) el.appendChild(document.createTextNode(text));
  fireEvent.input(el);
}

describe('KanbanAddInput', () => {
  it('hides the description field and buttons until the title is focused', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);
    expect(getDescription()).toBeNull();
    expect(getCreateButton()).toBeNull();

    fireEvent.focus(getTitle());
    expect(getDescription()).not.toBeNull();
    expect(getCreateButton()).not.toBeNull();
  });

  it('creates a title-only task when Enter is pressed in the title field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith('Fix login', undefined);
  });

  it('creates a task with title and description when the Create button is clicked', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    typeDescription('Sessions expire too early');
    fireEvent.click(getCreateButton()!);

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Sessions expire too early');
  });

  it('disables the Create button until the title has content', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    fireEvent.focus(getTitle());
    expect(getCreateButton()!.disabled).toBe(true);

    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    expect(getCreateButton()!.disabled).toBe(false);

    fireEvent.change(getTitle(), { target: { value: '   ' } });
    expect(getCreateButton()!.disabled).toBe(true);
  });

  it('creates with Cmd+Enter from the description field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    typeDescription('Details');
    fireEvent.keyDown(getDescription()!, { key: 'Enter', metaKey: true });

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Details');
  });

  it('creates with Ctrl+Enter from the description field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    typeDescription('Details');
    fireEvent.keyDown(getDescription()!, { key: 'Enter', ctrlKey: true });

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Details');
  });

  it('does not create on a bare Enter in the description field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    fireEvent.keyDown(getDescription()!, { key: 'Enter' });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('does not create when the title is empty or whitespace', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('clears the fields but keeps the form open for the next task after a create', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = getTitle();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Fix login' } });
    typeDescription('Details');
    fireEvent.keyDown(title, { key: 'Enter' });

    // Fields are cleared, but the form stays expanded so the next task can
    // be entered without clicking back in.
    expect(getTitle().value).toBe('');
    expect(getDescription()).not.toBeNull();
    expect(getDescription()!.textContent).toBe('');
    expect(getCreateButton()).not.toBeNull();
  });

  it('can create a second task in a row without re-focusing the form', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'First task' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    fireEvent.change(title, { target: { value: 'Second task' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenNthCalledWith(1, 'First task', undefined);
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Second task', undefined);
  });

  it('clears and collapses the form when Cancel is clicked', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    fireEvent.click(getCancelButton());

    expect(getTitle().value).toBe('');
    expect(getDescription()).toBeNull();
  });

  it('clears and collapses the form on Escape', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = getTitle();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.keyDown(title, { key: 'Escape' });

    expect(getTitle().value).toBe('');
    expect(getDescription()).toBeNull();
  });

  it('omits an empty description from the create call', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Fix login' } });
    typeDescription('   ');
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith('Fix login', undefined);
  });

  it('saves an image attachment as a markdown marker in the description on paste', async () => {
    const onAdd = vi.fn();
    const saveAttachment = vi.fn().mockResolvedValue({ success: true, path: '/tmp/img-test.png' });
    // Stub the IPC the editor calls on image paste.
    const original = (window as unknown as { api?: unknown }).api;
    (window as unknown as { api: { task: { saveAttachment: typeof saveAttachment } } }).api = {
      task: { saveAttachment },
    };

    render(<KanbanAddInput onAdd={onAdd} />);
    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'With image' } });

    const editor = getDescription()!;
    // Simulate a clipboard paste with one image item.
    const file = new File([new Uint8Array([1, 2, 3])], 'paste.png', { type: 'image/png' });
    const dataTransfer = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer;
    fireEvent.paste(editor, { clipboardData: dataTransfer });
    // Wait a tick for the async save to resolve and the chip to land.
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.click(getCreateButton()!);
    expect(saveAttachment).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('With image', '![](/tmp/img-test.png)');

    if (original !== undefined) {
      (window as unknown as { api: unknown }).api = original;
    } else {
      delete (window as unknown as { api?: unknown }).api;
    }
  });
});
