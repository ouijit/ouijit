/**
 * Behavior tests for the kanban add form. Users can enter a short title and,
 * by tabbing into the revealed description field, a full prompt before the
 * task is created.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { KanbanAddInput } from '../../components/kanban/KanbanAddInput';

const getTitle = () => screen.getByPlaceholderText('New task...') as HTMLInputElement;
const getDescription = () => screen.queryByPlaceholderText(/Description \(optional\)/) as HTMLTextAreaElement | null;

describe('KanbanAddInput', () => {
  it('hides the description field until the title is focused', () => {
    render(<KanbanAddInput onAdd={vi.fn()} />);
    expect(getDescription()).toBeNull();

    fireEvent.focus(getTitle());
    expect(getDescription()).not.toBeNull();
  });

  it('creates a title-only task when Enter is pressed in the title field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.change(title, { target: { value: 'Fix login' } });
    fireEvent.keyDown(title, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith('Fix login', undefined);
  });

  it('creates a task with title and description on Cmd+Enter in the description field', () => {
    const onAdd = vi.fn();
    render(<KanbanAddInput onAdd={onAdd} />);

    const title = getTitle();
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Fix login' } });

    const description = getDescription();
    expect(description).not.toBeNull();
    fireEvent.change(description!, { target: { value: 'Sessions expire too early' } });
    fireEvent.keyDown(description!, { key: 'Enter', metaKey: true });

    expect(onAdd).toHaveBeenCalledWith('Fix login', 'Sessions expire too early');
  });

  it('creates with Ctrl+Enter as well', () => {
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
