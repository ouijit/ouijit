/**
 * The Resume and Open in entries shared by the kanban card and the terminal
 * header, plus the file-manager reveal they delegate to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { closedTaskChats, openEntries, type TaskMenuActions } from '../../components/kanban/taskMenu';
import { terminalInstances } from '../../components/terminal/terminalRegistry';
import type { TaskChatSummary } from '../../chat/model';
import { fileManagerName, FILE_MANAGER_NAME, revealInFileManager } from '../../utils/fileManager';
import { useProjectStore } from '../../stores/projectStore';
import { useHomeChatStore } from '../../stores/homeChatStore';
import type { ContextMenuEntry, ContextMenuItem } from '../../components/ui/ContextMenu';

function actions(): TaskMenuActions {
  return {
    openTerminal: vi.fn(),
    openSession: vi.fn(),
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
  it('opens in the project default, names the other places, and opens apps only where they can', () => {
    const acts = actions();
    const entries = openEntries(['nono', 'custom'], true, acts, 'custom');
    expect(outline(entries)).toEqual([
      'Resume',
      'Resume in',
      ['Host', 'Sandbox'],
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    clickAll(entries);
    expect(vi.mocked(acts.openTerminal).mock.calls).toEqual([['custom'], ['none'], ['nono']]);
    expect(acts.openEditor).toHaveBeenCalled();
    expect(acts.openFolder).toHaveBeenCalled();
    // Every row carries an icon, so their labels line up.
    expect(entries.every((e) => 'separator' in e || e.icon)).toBe(true);

    // One other place is named outright rather than behind a submenu.
    expect(outline(openEntries(['nono'], true, actions(), 'none'))).toEqual([
      'Resume',
      'Resume in Sandbox',
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    expect(outline(openEntries(['nono'], true, actions(), 'nono'))).toContain('Resume on Host');

    // A to-do has nothing to resume yet, so it is started.
    expect(outline(openEntries(['nono'], false, actions(), 'none', false))).toEqual([
      'Start',
      'Start in Sandbox',
      'Open in',
      ['Editor'],
    ]);

    // With one place there is nowhere else to resume, and with no worktree on
    // disk there is nothing for the file manager to show. Resuming and the
    // editor create one, so they stay.
    expect(outline(openEntries([], false, actions(), 'none'))).toEqual(['Resume', 'Open in', ['Editor']]);
  });
});

describe('adding to a task', () => {
  it('offers a new chat beside what the task has once chat is on, a terminal where tasks open as chats, and the same in each other place', () => {
    useHomeChatStore.setState({ enabled: false });
    expect(outline(openEntries([], true, actions(), 'none'))).toEqual([
      'Resume',
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);

    useHomeChatStore.setState({ enabled: true });
    const acts = actions();
    const entries = openEntries([], true, acts, 'none');
    expect(outline(entries)).toEqual(['Resume', 'New chat', 'Open in', ['Editor', FILE_MANAGER_NAME]]);
    (entries[1] as ContextMenuItem).onClick();
    expect(acts.openSession).toHaveBeenCalledWith('chat', 'none');

    // Each appears once; the sandbox holds the same three behind one row.
    const placed = actions();
    const anywhere = openEntries(['nono'], true, placed, 'none', true, true);
    expect(outline(anywhere)).toEqual([
      'Resume',
      'New chat',
      'New terminal',
      'In Sandbox',
      ['Resume', 'New chat', 'New terminal'],
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    clickAll(anywhere);
    expect(vi.mocked(placed.openSession).mock.calls).toEqual([
      ['chat', 'none'],
      ['terminal', 'none'],
      ['chat', 'nono'],
      ['terminal', 'nono'],
    ]);
    expect(vi.mocked(placed.openTerminal).mock.calls).toEqual([['none'], ['nono']]);

    // More than one other place is a row each, under one.
    expect(outline(openEntries(['nono', 'custom'], true, actions(), 'none', true, true))).toEqual([
      'Resume',
      'New chat',
      'New terminal',
      'In a sandbox',
      ['Sandbox', ['Resume', 'New chat', 'New terminal'], 'Custom', ['Resume', 'New chat', 'New terminal']],
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    expect(outline(openEntries(['nono', 'custom'], true, actions(), 'nono'))).toContain('Elsewhere');

    // A to-do is started first, the way the setting says.
    expect(outline(openEntries([], false, actions(), 'none', false))).toEqual(['Start', 'Open in', ['Editor']]);
    useHomeChatStore.setState({ enabled: false });
  });

  it('lists the chats no card has open by what was first asked in them, and opens the one picked', () => {
    const chat = (id: string, taskId: number, firstMessage: string): TaskChatSummary => ({
      id,
      taskId,
      agent: 'claude',
      sandbox: null,
      firstMessage,
      updatedAt: '2026-11-17T00:00:00Z',
    });
    const project = [
      chat('a', 3, 'Make the login form remember the last email address that signed in on this machine'),
      chat('b', 3, 'Fix the flaky test\nIt fails one run in ten'),
      chat('c', 3, 'Open already'),
      chat('d', 4, 'Another task'),
    ];
    terminalInstances.set('c', {} as never);
    const chats = closedTaskChats(project, 3);
    terminalInstances.delete('c');
    expect(chats.map((c) => c.id)).toEqual(['a', 'b']);

    useHomeChatStore.setState({ enabled: true });
    const open = vi.fn();
    const entries = openEntries([], true, { ...actions(), earlierChats: { chats, open } }, 'none');
    expect(outline(entries)).toEqual([
      'Resume',
      'New chat',
      'Earlier chats',
      ['Make the login form remember the last email', 'Fix the flaky test'],
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    (entries[2] as { submenu: ContextMenuItem[] }).submenu[1].onClick();
    expect(open).toHaveBeenCalledWith(chats[1]);

    // With nothing closed there is nothing to list.
    expect(outline(openEntries([], true, { ...actions(), earlierChats: { chats: [], open } }, 'none'))).not.toContain(
      'Earlier chats',
    );
    useHomeChatStore.setState({ enabled: false });
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
