/**
 * Behavior tests for the shared chip editor. Covers the paths that aren't
 * exercised through the kanban add-form test: chip-aware Backspace/Delete,
 * imperative reset, drop-with-files, and onAttachFile being consulted before
 * the editor inserts a chip.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { DescriptionChipEditor, type DescriptionChipEditorHandle } from '../../components/kanban/DescriptionChipEditor';

/** Place the caret adjacent to `node`. `before=true` → just before it, else just after. */
function placeCaretAdjacentTo(node: Node, before: boolean): void {
  const parent = node.parentNode;
  if (!parent) throw new Error('Node has no parent');
  const index = Array.from(parent.childNodes).indexOf(node as ChildNode);
  const range = document.createRange();
  range.setStart(parent, before ? index : index + 1);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe('DescriptionChipEditor', () => {
  it('renders initial value with chips at the marker positions', () => {
    const { container } = render(<DescriptionChipEditor initialValue="before ![](/Users/a/p.png) after" />);
    const editor = container.querySelector('.kanban-description-editor')!;
    const chips = editor.querySelectorAll('.description-attachment-chip');
    expect(chips.length).toBe(1);
    expect(chips[0].getAttribute('data-attachment-path')).toBe('/Users/a/p.png');
    expect(editor.textContent).toBe('before  after');
  });

  it('fires onChange with the serialized value on input events', () => {
    const onChange = vi.fn();
    const { container } = render(<DescriptionChipEditor initialValue="hi" onChange={onChange} />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    editor.textContent = 'hi there';
    fireEvent.input(editor);
    expect(onChange).toHaveBeenLastCalledWith('hi there');
    // The CSS placeholder selector keys off data-empty, kept in sync by emitChange.
    expect(editor.dataset.empty).toBe('false');
  });

  it('reports data-empty=true when the value becomes empty so the placeholder shows', () => {
    const { container } = render(<DescriptionChipEditor initialValue="hi" placeholder="Type here" />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    expect(editor.dataset.empty).toBe('false');
    editor.textContent = '';
    fireEvent.input(editor);
    expect(editor.dataset.empty).toBe('true');
    expect(editor.getAttribute('data-placeholder')).toBe('Type here');
  });

  it('removes a chip on Backspace when the caret is immediately after it', () => {
    const onChange = vi.fn();
    const { container } = render(<DescriptionChipEditor initialValue="![](/p.png) tail" onChange={onChange} />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    const chip = editor.querySelector('.description-attachment-chip')!;
    placeCaretAdjacentTo(chip, /* before */ false);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    // The serializer trims, so the leading space disappears after the chip is gone.
    expect(onChange).toHaveBeenLastCalledWith('tail');
    expect(editor.querySelector('.description-attachment-chip')).toBeNull();
  });

  it('removes a chip on Delete when the caret is immediately before it', () => {
    const onChange = vi.fn();
    const { container } = render(<DescriptionChipEditor initialValue="head ![](/p.png)" onChange={onChange} />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    const chip = editor.querySelector('.description-attachment-chip')!;
    placeCaretAdjacentTo(chip, /* before */ true);
    fireEvent.keyDown(editor, { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith('head');
    expect(editor.querySelector('.description-attachment-chip')).toBeNull();
  });

  it('falls through Backspace to the parent onKeyDown when no chip is adjacent', () => {
    const parentKeyDown = vi.fn();
    const { container } = render(<DescriptionChipEditor initialValue="plain text" onKeyDown={parentKeyDown} />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    fireEvent.keyDown(editor, { key: 'Backspace' });
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it('calls onAttachFile on paste and inserts a chip for the returned path', async () => {
    const onAttachFile = vi.fn().mockResolvedValue('/saved/img.png');
    const onChange = vi.fn();
    const { container } = render(
      <DescriptionChipEditor initialValue="" onAttachFile={onAttachFile} onChange={onChange} />,
    );
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    const file = new File([new Uint8Array([1])], 'paste.png', { type: 'image/png' });
    const dataTransfer = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
    } as unknown as DataTransfer;
    fireEvent.paste(editor, { clipboardData: dataTransfer });
    await new Promise((r) => setTimeout(r, 0));

    expect(onAttachFile).toHaveBeenCalledTimes(1);
    expect(onAttachFile).toHaveBeenCalledWith(file);
    expect(editor.querySelector('.description-attachment-chip')!.getAttribute('data-attachment-path')).toBe(
      '/saved/img.png',
    );
    expect(onChange).toHaveBeenLastCalledWith('![](/saved/img.png)');
  });

  it('calls onAttachFile for each dropped file and appends chips in order', async () => {
    const onAttachFile = vi.fn().mockResolvedValueOnce('/Users/a/one.txt').mockResolvedValueOnce('/Users/a/two.pdf');
    const onChange = vi.fn();
    const { container } = render(
      <DescriptionChipEditor initialValue="" onAttachFile={onAttachFile} onChange={onChange} />,
    );
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    const f1 = new File([new Uint8Array([1])], 'one.txt', { type: 'text/plain' });
    const f2 = new File([new Uint8Array([1])], 'two.pdf', { type: 'application/pdf' });
    const dataTransfer = {
      items: [
        { kind: 'file', type: 'text/plain' },
        { kind: 'file', type: 'application/pdf' },
      ],
      files: [f1, f2],
    } as unknown as DataTransfer;
    fireEvent.drop(editor, { dataTransfer, clientX: 0, clientY: 0 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onAttachFile).toHaveBeenCalledTimes(2);
    expect(onAttachFile).toHaveBeenNthCalledWith(1, f1);
    expect(onAttachFile).toHaveBeenNthCalledWith(2, f2);
    expect(onChange).toHaveBeenLastCalledWith('![](/Users/a/one.txt)![](/Users/a/two.pdf)');
  });

  it('skips files for which onAttachFile returns null', async () => {
    const onAttachFile = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('/Users/a/ok.png');
    const onChange = vi.fn();
    const { container } = render(
      <DescriptionChipEditor initialValue="" onAttachFile={onAttachFile} onChange={onChange} />,
    );
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    const f1 = new File([new Uint8Array([1])], 'skipped.bin', { type: 'application/octet-stream' });
    const f2 = new File([new Uint8Array([1])], 'ok.png', { type: 'image/png' });
    const dataTransfer = {
      items: [
        { kind: 'file', type: 'application/octet-stream' },
        { kind: 'file', type: 'image/png' },
      ],
      files: [f1, f2],
    } as unknown as DataTransfer;
    fireEvent.drop(editor, { dataTransfer, clientX: 0, clientY: 0 });
    await new Promise((r) => setTimeout(r, 0));

    expect(onChange).toHaveBeenLastCalledWith('![](/Users/a/ok.png)');
    expect(editor.querySelectorAll('.description-attachment-chip').length).toBe(1);
  });

  it('resets the DOM via the imperative setValue handle', () => {
    const ref = createRef<DescriptionChipEditorHandle>();
    const { container } = render(<DescriptionChipEditor ref={ref} initialValue="![](/a.png) hi" />);
    const editor = container.querySelector('.kanban-description-editor') as HTMLDivElement;
    expect(editor.querySelectorAll('.description-attachment-chip').length).toBe(1);
    ref.current!.setValue('');
    expect(editor.querySelector('.description-attachment-chip')).toBeNull();
    expect(editor.textContent).toBe('');
    expect(editor.dataset.empty).toBe('true');
  });
});
