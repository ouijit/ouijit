import { test, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebPreviewPanel } from '../../components/webPreview/WebPreviewPanel';
import { PanelBar } from '../../components/terminal/PanelTabs';
import { DEFAULT_DISPLAY_STATE, useTerminalStore } from '../../stores/terminalStore';
import type { WebPreviewPanel as Preview } from '../../components/terminal/panelTypes';

const PTY = 'pty-preview';

test("a preview's tab is named for the page and wears its icon, and a page without one goes back to the globe", () => {
  const panel: Preview = { id: 'panel-1', kind: 'webPreview', url: 'http://localhost:4321/writing' };
  useTerminalStore.getState().addTerminal('/code/site', PTY, {
    ...DEFAULT_DISPLAY_STATE,
    ptyId: PTY,
    panels: [panel],
    activePanelId: panel.id,
  });
  const update = (info: Partial<Preview>) => {
    const [current] = useTerminalStore.getState().displayStates[PTY].panels as Preview[];
    useTerminalStore.getState().updateDisplay(PTY, { panels: [{ ...current, ...info }] });
  };
  const { container } = render(
    <>
      <PanelBar ptyId={PTY} />
      <WebPreviewPanel ptyId={PTY} panelId={panel.id} url={panel.url!} onChangeUrl={() => {}} onPageInfo={update} />
    </>,
  );
  const webview = container.querySelector('webview')!;
  const tab = () => screen.getByRole('tab');

  // Before the page says anything: its host, and the globe.
  expect(tab().textContent).toContain('localhost:4321');
  expect(tab().querySelector('img')).toBeNull();

  act(() => {
    fireEvent(webview, Object.assign(new Event('page-title-updated'), { title: 'Writing · Ouijit' }));
    fireEvent(
      webview,
      Object.assign(new Event('page-favicon-updated'), { favicons: ['http://localhost:4321/favicon.svg'] }),
    );
  });
  expect(tab().textContent).toContain('Writing · Ouijit');
  expect(tab().querySelector('img')?.getAttribute('src')).toBe('http://localhost:4321/favicon.svg');

  // Another page, naming no icon of its own: not the last page's.
  act(() => {
    fireEvent(webview, Object.assign(new Event('did-navigate'), { url: 'http://localhost:4321/about' }));
  });
  expect(tab().querySelector('img')).toBeNull();
});
