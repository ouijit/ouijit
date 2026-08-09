import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ResizeHandle } from '../../components/common/ResizeHandle';

function handle() {
  return screen.getByRole('separator');
}

describe('ResizeHandle', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test('dragging reports the new width', () => {
    const onWidth = vi.fn();
    render(<ResizeHandle width={300} onWidth={onWidth} min={200} max={500} />);

    fireEvent.mouseDown(handle(), { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 460 });
    expect(onWidth).toHaveBeenLastCalledWith(360);

    fireEvent.mouseUp(document);
  });

  test('a drag past the limits stops at them', () => {
    const onWidth = vi.fn();
    render(<ResizeHandle width={300} onWidth={onWidth} min={200} max={500} />);

    fireEvent.mouseDown(handle(), { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 4000 });
    expect(onWidth).toHaveBeenLastCalledWith(500);
    fireEvent.mouseMove(document, { clientX: -4000 });
    expect(onWidth).toHaveBeenLastCalledWith(200);

    fireEvent.mouseUp(document);
  });

  test('the drag stops listening once the button is released', () => {
    const onWidth = vi.fn();
    render(<ResizeHandle width={300} onWidth={onWidth} min={200} max={500} />);

    fireEvent.mouseDown(handle(), { clientX: 400 });
    fireEvent.mouseUp(document);
    onWidth.mockClear();

    // Otherwise the pane keeps resizing as the pointer wanders the window.
    fireEvent.mouseMove(document, { clientX: 800 });
    expect(onWidth).not.toHaveBeenCalled();
  });

  test('the page stops selecting text while a drag is in progress', () => {
    render(<ResizeHandle width={300} onWidth={vi.fn()} min={200} max={500} />);

    fireEvent.mouseDown(handle(), { clientX: 400 });
    // Without this, dragging the handle sweeps a selection across the diff
    // behind it.
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.mouseUp(document);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  test('double-clicking returns to the default width', () => {
    const onWidth = vi.fn();
    render(<ResizeHandle width={480} onWidth={onWidth} min={200} max={500} defaultWidth={320} />);

    fireEvent.doubleClick(handle());
    expect(onWidth).toHaveBeenCalledWith(320);
  });

  test('arrow keys resize it without a pointer', () => {
    const onWidth = vi.fn();
    render(<ResizeHandle width={300} onWidth={onWidth} min={200} max={500} />);

    // Three pixels wide is the least reachable target on the page.
    fireEvent.keyDown(handle(), { key: 'ArrowRight' });
    expect(onWidth).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(handle(), { key: 'ArrowLeft' });
    expect(onWidth).toHaveBeenLastCalledWith(284);
    fireEvent.keyDown(handle(), { key: 'End' });
    expect(onWidth).toHaveBeenLastCalledWith(500);
    fireEvent.keyDown(handle(), { key: 'Home' });
    expect(onWidth).toHaveBeenLastCalledWith(200);
  });

  test('it says how wide the pane is', () => {
    render(<ResizeHandle width={300} onWidth={vi.fn()} min={200} max={500} label="Resize the list" />);

    const separator = handle();
    expect(separator.getAttribute('aria-valuenow')).toBe('300');
    expect(separator.getAttribute('aria-valuemin')).toBe('200');
    expect(separator.getAttribute('aria-valuemax')).toBe('500');
    expect(separator.getAttribute('aria-label')).toBe('Resize the list');
  });
});
