/**
 * The "Open in" submenu shared by the kanban card and the terminal header,
 * plus the file-manager reveal it delegates to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openInEntry, type TaskMenuActions } from '../../components/kanban/taskMenu';
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

function submenuOf(entry: ContextMenuEntry): ContextMenuItem[] {
  if (!('submenu' in entry)) throw new Error('expected a submenu');
  return entry.submenu.filter((e): e is ContextMenuItem => 'onClick' in e);
}

describe('openInEntry', () => {
  it('offers the file manager (and sandboxes) only once the task has a worktree', () => {
    const withWorktree = submenuOf(openInEntry(['nono'], true, actions()));
    expect(withWorktree.map((i) => i.label)).toEqual(['Terminal', 'nono sandbox', 'Editor', FILE_MANAGER_NAME]);

    const withoutWorktree = submenuOf(openInEntry(['nono'], false, actions()));
    expect(withoutWorktree.map((i) => i.label)).toEqual(['Terminal', 'Editor']);
  });

  it('runs openFolder when the file manager entry is clicked', () => {
    const acts = actions();
    const entry = submenuOf(openInEntry([], true, acts)).find((i) => i.label === FILE_MANAGER_NAME);
    entry!.onClick();
    expect(acts.openFolder).toHaveBeenCalled();
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

  it('toasts when the OS refuses to open the path', async () => {
    vi.mocked(window.api.openInFinder).mockResolvedValueOnce({ success: false, error: 'no such file' });
    await revealInFileManager('/tmp/gone');
    const [toast] = useProjectStore.getState().toasts;
    expect(toast.type).toBe('error');
    expect(toast.message).toContain('/tmp/gone');
  });
});
