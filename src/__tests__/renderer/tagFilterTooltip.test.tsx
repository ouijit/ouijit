import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagFilterControl } from '../../components/terminal/TagFilterControl';

function renderHomeToggle(tags: string[]) {
  return render(
    <TagFilterControl
      variant="segment"
      label="Group or filter by tag"
      tags={tags}
      value={null}
      active={false}
      allSelected={false}
      onSelectAll={() => {}}
      onSelectTag={() => {}}
    />,
  );
}

describe('home tag toggle tooltip', () => {
  test('shows on hover with or without tags, and gives way to the open menu', async () => {
    const { unmount } = renderHomeToggle([]);
    const plain = screen.getByRole('button', { name: 'Group or filter by tag' });
    fireEvent.mouseEnter(plain);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Group or filter by tag');
    unmount();

    renderHomeToggle(['bug', 'feature']);
    const withMenu = screen.getByRole('button', { name: 'Group or filter by tag' });
    fireEvent.mouseEnter(withMenu);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Group or filter by tag');

    fireEvent.click(withMenu);
    expect(screen.getByRole('button', { name: 'bug' })).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
