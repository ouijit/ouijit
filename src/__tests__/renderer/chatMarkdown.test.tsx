import { test, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ChatMarkdown } from '../../components/chat/ChatMarkdown';

test('ouijit:// links in a reply are links Ouijit opens, written bare or as markdown', () => {
  const { container } = render(
    <ChatMarkdown
      complete
      text={[
        'See ouijit://horizon/tasks/14/diff/src/auth.ts:88.',
        'Or [the board](ouijit://horizon/board), [docs](https://example.com) and `ouijit://not/a/link`.',
      ].join('\n')}
    />,
  );
  const links = [...container.querySelectorAll('a')];
  expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
    ['ouijit://horizon/tasks/14/diff/src/auth.ts:88', 'ouijit://horizon/tasks/14/diff/src/auth.ts:88'],
    ['the board', 'ouijit://horizon/board'],
    ['docs', 'https://example.com'],
  ]);
  // Ouijit takes the click rather than letting the window navigate.
  expect(fireEvent.click(links[1])).toBe(false);
  expect(fireEvent.click(links[2])).toBe(true);
});
