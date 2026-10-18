import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '../../components/ui/Tooltip';

describe('Tooltip', () => {
  test('opens on hover from its own element or a wrapper, and stays shut for empty text', async () => {
    render(
      <>
        <Tooltip text="Wrapped">
          <button>wrapped</button>
        </Tooltip>
        <Tooltip text="Own element">
          {(ref, props) => (
            <button ref={ref} {...props}>
              own
            </button>
          )}
        </Tooltip>
        <Tooltip text={undefined}>
          {(ref, props) => (
            <button ref={ref} {...props}>
              empty
            </button>
          )}
        </Tooltip>
      </>,
    );

    const own = screen.getByRole('button', { name: 'own' });
    expect(own.parentElement).toBe(document.body.firstElementChild);
    fireEvent.mouseEnter(own);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Own element');
    fireEvent.mouseLeave(own);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'wrapped' }).parentElement!);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Wrapped');
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'wrapped' }).parentElement!);

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'empty' }));
    await new Promise((r) => setTimeout(r, 150));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
