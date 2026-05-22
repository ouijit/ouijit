/**
 * Behavior tests for the kanban add form. Users can enter a short title and,
 * by tabbing into the revealed description field, a full prompt before the
 * task is created. A Create button is the primary, always-visible action.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { KanbanAddInput } from '../../components/kanban/KanbanAddInput';

const getTitle = () => screen.getByPlaceholderText('New task...') as HTMLInputElement;
const getDescription = () => screen.queryByPlaceholderText('Description (optional)') as HTMLTextAreaElement | null;
const getCreateButton = () => screen.queryByRole('button', { name: 'Create' }) as HTMLButtonElement | null;
const getCancelButton = () => screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

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
    fireEvent.change(getDescription()!, { target: { value: 'Sessions expire too early' } });
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
    const description = getDescription()!;
    fireEvent.change(description, { target: { value: 'Details' } });
    fireEvent.keyDown(description, { key: 'Enter', metaKey: true });

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Details');
  });

  it('creates with Ctrl+Enter from the description field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    fireEvent.focus(getTitle());
    fireEvent.change(getTitle(), { target: { value: 'Fix login' } });
    const description = getDescription()!;
    fireEvent.change(description, { target: { value: 'Details' } });
    fireEvent.keyDown(description, { key: 'Enter', ctrlKey: true });

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

  it('clears both fields after a successful create', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);

    const title = getTitle();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.change(getDescription()!, { target: { value: 'Details' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(getTitle().value).toBe('');
    expect(getDescription()).toBeNull();
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
    fireEvent.change(getDescription()!, { target: { value: '   ' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith('Fix login', undefined);
  });
});
