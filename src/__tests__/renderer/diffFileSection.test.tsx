import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * Tokenizing is asynchronous and splits a line into a span per token, so what
 * is on screen at the moment of an assertion depends on whether shiki has come
 * back yet. Stubbed so the DOM under test is the one being described here;
 * highlighting itself is covered in `diffRendering.test.ts`, which runs in node
 * against the real highlighter.
 */
vi.mock('../../utils/syntaxHighlight', () => ({
  peekDiffTokens: (hunks: Array<{ lines: unknown[] }>) => hunks.map((hunk) => hunk.lines.map(() => null)),
  tokenizeDiffHunks: async (hunks: Array<{ lines: unknown[] }>) => hunks.map((hunk) => hunk.lines.map(() => null)),
}));

import { DiffFileSection } from '../../components/diff/DiffFileSection';
import type { FileDiff } from '../../types';

const diff: FileDiff = {
  path: 'src/app.ts',
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      lines: [
        { type: 'context', content: 'const a = 1;', oldLineNo: 1, newLineNo: 1 },
        { type: 'deletion', content: 'const b = 2;', oldLineNo: 2 },
        { type: 'addition', content: 'const b = 3;', newLineNo: 2 },
      ],
    },
  ],
};

/**
 * The three rows of the fixture above, in order.
 *
 * By position rather than by text: word-level highlighting splits a changed
 * line across several spans, so no single element holds the whole of one.
 */
function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('div.leading-normal'));
}

describe('DiffFileSection', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /**
   * Not a CSS hover rule over a button on every line: that is a button and an
   * inline SVG per line, of which at most one is ever visible — tens of
   * thousands of nodes across a large pull request so that one can be seen.
   */
  test('only the line under the pointer offers to be commented on', () => {
    const { container } = render(
      <DiffFileSection path="src/app.ts" status="M" additions={1} deletions={1} diff={diff} onAddComment={vi.fn()} />,
    );

    expect(rows(container)).toHaveLength(3);
    expect(screen.queryAllByTitle('Comment on this line')).toHaveLength(0);

    fireEvent.mouseEnter(rows(container)[0]);
    expect(screen.queryAllByTitle('Comment on this line')).toHaveLength(1);
  });

  test('the pointer moving to another line moves the button with it', () => {
    const onAddComment = vi.fn();
    const { container } = render(
      <DiffFileSection
        path="src/app.ts"
        status="M"
        additions={1}
        deletions={1}
        diff={diff}
        onAddComment={onAddComment}
      />,
    );

    const [context, , addition] = rows(container);
    fireEvent.mouseEnter(context);
    fireEvent.mouseEnter(addition);
    expect(screen.queryAllByTitle('Comment on this line')).toHaveLength(1);

    fireEvent.click(screen.getByTitle('Comment on this line'));
    // An addition anchors RIGHT, at its new-file line number.
    expect(onAddComment).toHaveBeenCalledWith('src/app.ts', { line: 2, side: 'RIGHT' });
  });

  test('a deletion anchors to the base blob instead', () => {
    const onAddComment = vi.fn();
    const { container } = render(
      <DiffFileSection
        path="src/app.ts"
        status="M"
        additions={1}
        deletions={1}
        diff={diff}
        onAddComment={onAddComment}
      />,
    );

    fireEvent.mouseEnter(rows(container)[1]);
    fireEvent.click(screen.getByTitle('Comment on this line'));
    expect(onAddComment).toHaveBeenCalledWith('src/app.ts', { line: 2, side: 'LEFT' });
  });

  /**
   * Reviewing a large pull request means getting what you have finished with
   * out of the way. Folded, a file is its header — so scrolling past the work
   * already done costs one row rather than its whole diff.
   */
  test('folding a file leaves its header and nothing else', () => {
    const onCollapsedChange = vi.fn();
    const { container, rerender } = render(
      <DiffFileSection
        path="src/app.ts"
        status="M"
        additions={1}
        deletions={1}
        diff={diff}
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
        collapseLabel="Viewed"
      />,
    );

    expect(rows(container)).toHaveLength(3);
    fireEvent.click(screen.getByLabelText('Viewed'));
    expect(onCollapsedChange).toHaveBeenCalledWith('src/app.ts', true);

    rerender(
      <DiffFileSection
        path="src/app.ts"
        status="M"
        additions={1}
        deletions={1}
        diff={diff}
        collapsed
        onCollapsedChange={onCollapsedChange}
        collapseLabel="Viewed"
      />,
    );

    expect(rows(container)).toHaveLength(0);
    // The header stays: it is the way back, and the only thing naming the file.
    expect(screen.getByTitle('src/app.ts')).toBeTruthy();
    expect(screen.getByLabelText('Viewed').getAttribute('aria-pressed')).toBe('true');
  });

  test('no fold control without a handler for it', () => {
    render(<DiffFileSection path="src/app.ts" status="M" additions={1} deletions={1} diff={diff} />);
    expect(screen.queryByLabelText('Viewed')).toBeNull();
    expect(screen.queryByLabelText('Collapse')).toBeNull();
  });

  test('a view with no comment handler offers nothing on hover', () => {
    // The worktree diff panel renders the same primitive and has no review to
    // add to; it should not grow a button that leads nowhere.
    const { container } = render(
      <DiffFileSection path="src/app.ts" status="M" additions={1} deletions={1} diff={diff} />,
    );

    fireEvent.mouseEnter(rows(container)[0]);
    expect(screen.queryAllByTitle('Comment on this line')).toHaveLength(0);
  });
});
