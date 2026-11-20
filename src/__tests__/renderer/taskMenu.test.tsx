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
  it('offers a new chat beside what the task has once chat is on, and a terminal where tasks open as chats', () => {
    useHomeChatStore.setState({ enabled: false, taskSurface: 'terminal' });
    expect(outline(openEntries([], true, actions(), 'none'))).toEqual([
      'Resume',
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);

    useHomeChatStore.setState({ enabled: true, taskSurface: 'terminal' });
    const acts = actions();
    const entries = openEntries([], true, acts, 'none');
    expect(outline(entries)).toEqual(['Resume', 'New chat', 'Open in', ['Editor', FILE_MANAGER_NAME]]);
    (entries[1] as ContextMenuItem).onClick();
    expect(acts.openSession).toHaveBeenCalledWith('chat', 'none');

    // Each opens in any place, the way Resume does.
    useHomeChatStore.setState({ taskSurface: 'chat' });
    const placed = actions();
    const anywhere = openEntries(['nono'], true, placed, 'none');
    expect(outline(anywhere)).toEqual([
      'Resume',
      'Resume in Sandbox',
      'New chat',
      'New chat in Sandbox',
      'New terminal',
      'New terminal in Sandbox',
      'Open in',
      ['Editor', FILE_MANAGER_NAME],
    ]);
    clickAll(anywhere);
    expect(vi.mocked(placed.openSession).mock.calls).toEqual([
      ['chat', 'none'],
      ['chat', 'nono'],
      ['terminal', 'none'],
      ['terminal', 'nono'],
    ]);
    // A to-do is started first, the way the setting says.
    expect(outline(openEntries([], false, actions(), 'none', false))).toEqual(['Start', 'Open in', ['Editor']]);
    useHomeChatStore.setState({ enabled: false, taskSurface: 'terminal' });
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

    useHomeChatStore.setState({ enabled: true, taskSurface: 'terminal' });
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
    useHomeChatStore.setState({ enabled: false, taskSurface: 'terminal' });
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
