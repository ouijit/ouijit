import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import { DeferredMount } from '../../components/diff/DeferredMount';

/** Put the next rendered element at a given distance down the page. */
function placeAt(top: number, height = 500) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe('DeferredMount', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a section in view renders in the same pass, with no placeholder first', () => {
    placeAt(0);
    render(
      <DeferredMount estimatedHeight={400}>
        <div>the diff</div>
      </DeferredMount>,
    );
    // Not `findByText`: the point is that it is there immediately. Waiting for
    // an observer callback would mean a frame of blank space where the file is.
    expect(screen.getByText('the diff')).toBeTruthy();
  });

  test('a section far below the fold holds its place instead of rendering', () => {
    placeAt(50_000);
    const { container } = render(
      <DeferredMount estimatedHeight={400}>
        <div>the diff</div>
      </DeferredMount>,
    );

    expect(screen.queryByText('the diff')).toBeNull();
    // The height has to be held, or every file below this one sits at the wrong
    // scroll offset.
    expect((container.firstChild as HTMLElement).style.height).toBe('400px');
  });

  test('it renders once it has been scrolled near', () => {
    placeAt(50_000);

    let notify: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
    const observers = { count: 0 };
    // Assigned rather than stubbed: the shared setup defines this property as
    // writable but not configurable, which `vi.stubGlobal` cannot replace.
    const original = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        notify = callback;
        observers.count++;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;

    render(
      <DeferredMount estimatedHeight={400}>
        <div>the diff</div>
      </DeferredMount>,
    );
    expect(observers.count).toBe(1);
    expect(screen.queryByText('the diff')).toBeNull();

    act(() => notify?.([{ isIntersecting: true }]));
    expect(screen.getByText('the diff')).toBeTruthy();

    window.IntersectionObserver = original;
  });

  test('a path is findable before the section it names has rendered', () => {
    placeAt(50_000);
    const { container } = render(
      <DeferredMount estimatedHeight={400} dataPath="src/app.ts">
        <div>the diff</div>
      </DeferredMount>,
    );

    // Clicking a file in the tree scrolls to `[data-path]`. If only the mounted
    // sections carried one, jumping to a file you had not scrolled past would
    // do nothing at all.
    expect(container.querySelector('[data-path="src/app.ts"]')).toBeTruthy();
  });
});
