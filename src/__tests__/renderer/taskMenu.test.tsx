/**
 * The Resume and Open in entries shared by the kanban card and the terminal
 * header, plus the file-manager reveal they delegate to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openEntries, type TaskMenuActions } from '../../components/kanban/taskMenu';
import { fileManagerName, FILE_MANAGER_NAME, revealInFileManager } from '../../utils/fileManager';
import { useProjectStore } from '../../stores/projectStore';
import type { ContextMenuEntry, ContextMenuItem } from '../../components/ui/ContextMenu';

function actions(): TaskMenuActions {
  return {
    openTerminal: vi.fn(),
    openEditor: vi.fn(),
    openFolder: vi.fn(),
    setStatus: vi.fn(),
    trash: vi.fn(),
  };
}

/** Each entry's label, with a submenu's labels nested under it. */
function outline(entries: ContextMenuEntry[]): unknown[] {
  return entries.flatMap((e): unknown[] => {
    if ('submenu' in e) return [e.label, outline(e.submenu)];
    return 'label' in e ? [e.label] : [];
  });
}

function clickAll(entries: ContextMenuEntry[]): void {
  for (const e of entries) {
    if ('submenu' in e) clickAll(e.submenu);
    else if ('onClick' in e) (e as ContextMenuItem).onClick();
  }
}

describe('resuming and opening a task', () => {
  it('resumes where the project defaults to, names every place, and opens apps only where they can', () => {
    const acts = actions();
    const entries = openEntries(['nono', 'custom'], true, acts, 'custom');
    expect(outline(entries)).toEqual([
      'Resume',
      'Resume in',
      ['Host', 'Sandbox', 'Custom'],
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    const places = (entries[1] as { submenu: ContextMenuItem[] }).submenu;
    expect(places.filter((place) => place.checked).map((place) => place.label)).toEqual(['Custom']);
    clickAll(entries);
    expect(vi.mocked(acts.openTerminal).mock.calls).toEqual([['custom'], ['none'], ['nono'], ['custom']]);
    expect(acts.openEditor).toHaveBeenCalled();
    expect(acts.openFolder).toHaveBeenCalled();

    // One other place is named outright rather than behind a submenu.
    expect(outline(openEntries(['nono'], true, actions(), 'none'))).toEqual([
      'Resume',
      'Resume in Sandbox',
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);

    // With one place there is nowhere else to resume, and with no worktree on
    // disk there is nothing for the file manager to show. Resuming and the
    // editor create one, so they stay.
    expect(outline(openEntries([], false, actions(), 'none'))).toEqual(['Resume', 'Open in', ['Editor']]);
  });
});

describe('fileManagerName', () => {
  it('names the platform file manager', () => {
    expect(fileManagerName('MacIntel')).toBe('Finder');
    expect(fileManagerName('Win32')).toBe('File Explorer');
    expect(fileManagerName('Linux x86_64')).toBe('File Manager');
  });
});

describe('revealInFileManager', () => {
  beforeEach(() => {
    vi.mocked(window.api.openInFinder).mockClear();
    useProjectStore.setState({ toasts: [] });
  });

  it('opens the path and stays quiet on success', async () => {
    vi.mocked(window.api.openInFinder).mockResolvedValueOnce({ success: true });
    await revealInFileManager('/tmp/worktree');
    expect(window.api.openInFinder).toHaveBeenCalledWith('/tmp/worktree');
    expect(useProjectStore.getState().toasts).toHaveLength(0);
  });

  it('toasts the OS reason when it refuses to open the path', async () => {
    vi.mocked(window.api.openInFinder).mockResolvedValueOnce({ success: false, error: 'no such file' });
    await revealInFileManager('/tmp/gone');
    const [toast] = useProjectStore.getState().toasts;
    expect(toast.type).toBe('error');
    expect(toast.message).toContain('/tmp/gone');
    expect(toast.message).toContain('no such file');
  });

  it('toasts instead of rejecting when the invoke itself fails', async () => {
    vi.mocked(window.api.openInFinder).mockRejectedValueOnce(new Error('channel closed'));
    await revealInFileManager('/tmp/worktree');
    const [toast] = useProjectStore.getState().toasts;
    expect(toast.type).toBe('error');
    expect(toast.message).toContain('channel closed');
  });
});
