import { test, expect, vi } from 'vitest';
import { render, fireEvent, screen, within } from '@testing-library/react';
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

test('a set of images in a reply lays out at their own shapes, fills its column, and opens full size one after another', () => {
  // jsdom lays nothing out: the column is 700px wide, and each image says its size once loaded.
  const column = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('chat-images') ? 700 : 0;
  });
  try {
    const { container } = render(
      <ChatMarkdown
        complete
        text={[
          '![The trailer at dusk](file:///shots/wide-1.jpg)',
          '![The steps](file:///shots/tall.jpg)',
          '![The field](file:///shots/wide-2.jpg)',
        ].join(' ')}
      />,
    );
    const images = [...container.querySelectorAll<HTMLImageElement>('.chat-images > img')];
    expect(images).toHaveLength(3);
    // Each says what it shows when hovered.
    expect(images.map((img) => img.title)).toEqual(['The trailer at dusk', 'The steps', 'The field']);

    const sizes: Record<string, [number, number]> = {
      'The trailer at dusk': [1600, 900],
      'The steps': [800, 1200],
      'The field': [1600, 900],
    };
    for (const img of images) {
      const [w, h] = sizes[img.alt];
      Object.defineProperty(img, 'naturalWidth', { value: w });
      Object.defineProperty(img, 'naturalHeight', { value: h });
      fireEvent.load(img);
    }
    // One height, each image at its own shape, the row exactly the column's width.
    const boxes = images.map((img) => [parseFloat(img.style.width), parseFloat(img.style.height)]);
    expect(new Set(boxes.map(([, h]) => h)).size).toBe(1);
    expect(boxes.reduce((sum, [w]) => sum + w, 0) + 6 * 2).toBe(700);
    expect(boxes[0][0] / boxes[0][1]).toBeCloseTo(16 / 9, 1);
    expect(boxes[1][0] / boxes[1][1]).toBeCloseTo(2 / 3, 1);

    // Clicked, one opens full size, and the arrows go through the rest of its set.
    fireEvent.click(images[1]);
    const viewer = screen.getByRole('dialog', { name: 'Image' });
    expect(within(viewer).getByText('2 of 3')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(within(viewer).getByText('3 of 3')).toBeTruthy();
  } finally {
    column.mockRestore();
  }
});
