import { expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../../components/chat/ChatMarkdown';

test('images shown one after another are one set, opened full size and stepped through', () => {
  const md = [
    'The sidebar:',
    '',
    '![one](/tmp/one.png)',
    '',
    'Then the three:',
    '',
    '![a](/tmp/a.png)',
    '![b](/tmp/b.png)',
    '',
    '![c](/tmp/c.png)',
    '',
    'Inline ![d](/tmp/d.png) in a sentence.',
  ].join('\n');
  const { container } = render(<ChatMarkdown text={md} complete />);

  // A blank line between them does not split a set; an image among words stays with them.
  const sets = [...container.querySelectorAll('.chat-images')].map((set) =>
    [...set.querySelectorAll('img')].map((img) => img.getAttribute('alt')),
  );
  expect(sets).toEqual([['one'], ['a', 'b', 'c']]);
  expect(screen.getByAltText('d').closest('p')?.textContent).toContain('in a sentence');

  fireEvent.click(screen.getByAltText('b'));
  const viewer = screen.getByRole('dialog', { name: 'Image' });
  expect(viewer.textContent).toBe('2 of 3');
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(viewer.textContent).toBe('3 of 3');
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(viewer.textContent).toBe('3 of 3');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Image' })).toBeNull();

  // A lone image opens on its own, with nothing to step to.
  fireEvent.click(screen.getByAltText('one'));
  expect(screen.getByRole('dialog', { name: 'Image' }).textContent).toBe('');
});
