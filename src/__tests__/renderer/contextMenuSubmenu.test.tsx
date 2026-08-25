import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { ContextMenu, type ContextMenuEntry } from '../../components/ui/ContextMenu';

const ITEMS: ContextMenuEntry[] = [
  { label: 'Open in', submenu: [{ label: 'Terminal', onClick: vi.fn() }] },
  { label: 'Rename', onClick: vi.fn() },
  { label: 'Trash', danger: true, onClick: vi.fn() },
];

const row = (label: string) => screen.getByText(label).closest('div')!;

function openSubmenu() {
  render(<ContextMenu x={0} y={0} items={ITEMS} onClose={vi.fn()} />);
  fireEvent.mouseEnter(row('Open in'));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ContextMenu submenus', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('outlast the rows the pointer crosses on a diagonal into the flyout', () => {
    openSubmenu();

    fireEvent.mouseLeave(row('Open in'));
    fireEvent.mouseEnter(screen.getByText('Rename'));
    advance(150);
    fireEvent.mouseEnter(screen.getByText('Terminal'));
    advance(1000);

    expect(screen.queryByText('Terminal')).not.toBeNull();
  });

  test('close once the pointer has settled elsewhere', () => {
    openSubmenu();

    fireEvent.mouseLeave(row('Open in'));
    fireEvent.mouseEnter(screen.getByText('Trash'));
    advance(1000);

    expect(screen.queryByText('Terminal')).toBeNull();
  });
});
