import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AboutDialog } from '../../components/dialogs/AboutDialog';
import { WEBSITE_URL, DOCS_URL, REPO_URL } from '../../constants/links';

describe('About dialog', () => {
  test('shows the running version and opens each link in the browser', () => {
    render(<AboutDialog version="1.9.0" onClose={vi.fn()} />);

    expect(screen.getByText('Version 1.9.0')).toBeTruthy();

    for (const [label, url] of [
      ['Website', WEBSITE_URL],
      ['Docs', DOCS_URL],
      ['GitHub', REPO_URL],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(window.api.openExternal).toHaveBeenCalledWith(url);
    }
  });
});
