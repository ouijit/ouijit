import { ipcMain, shell, BrowserWindow, dialog } from 'electron';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanForProjects, getAddedProjects, addProject, removeProject } from './scanner';
import {
  spawnPty,
  reconnectPty,
  getActiveSessions,
  setWindow,
  writeToPty,
  resizePty,
  killPty,
  cleanupAllPtys,
} from './ptyManager';
import * as limaPlugin from './lima';
import { getGitStatus, getCompactGitStatus, getGitDropdownInfo, checkoutBranch, createBranch, mergeIntoMain, getChangedFiles, getFileDiff, getWorktreeDiff, getWorktreeFileDiff, mergeWorktreeBranch, listBranches, getMainBranch } from './git';
import { createTaskWorktree, removeTaskWorktree, listWorktrees, formatBranchNameForDisplay } from './worktree';
import type { TaskWorktreeResult, WorktreeRemoveResult, WorktreeInfo } from './worktree';
import {
  getProjectTasks,
  closeTask,
  reopenTask,
  setTaskReadyToShip,
  setTaskMergeTarget,
  setTaskSandboxed,
  ensureTaskExists,
  getTask,
} from './taskMetadata';
import {
  getProjectSettings,
  setKillExistingOnRun,
  getHook,
  getHooks,
  saveHook,
  deleteHook,
} from './projectSettings';
import { executeHook } from './hookRunner';
import type { PtySpawnOptions, CreateProjectOptions, CreateProjectResult, ProjectSettings, GitStatus, CompactGitStatus, GitDropdownInfo, ChangedFile, FileDiff, WorktreeDiffSummary, GitMergeResult, WorktreeWithMetadata, ScriptHook, HookType, BranchInfo } from './types';

/**
 * Registers all IPC handlers for the main process
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Handler to get all detected projects
  ipcMain.handle('get-projects', async () => {
    try {
      const projects = await scanForProjects();
      return projects;
    } catch (error) {
      console.error('Error scanning for projects:', error);
      throw error;
    }
  });

  // Handler to open a project in the default file manager
  ipcMain.handle('open-project', async (_event, projectPath: string) => {
    try {
      await shell.openPath(projectPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening project:', error);
      throw error;
    }
  });

  // Handler to open project in Finder explicitly
  ipcMain.handle('open-in-finder', async (_event, projectPath: string) => {
    try {
      await shell.openPath(projectPath);
      return { success: true };
    } catch (error) {
      console.error('Error opening in Finder:', error);
      throw error;
    }
  });

  // Lima sandbox handlers
  limaPlugin.registerLimaHandlers(mainWindow);

  // PTY handlers
  ipcMain.handle('pty:spawn', async (_event, options: PtySpawnOptions) => {
    if (options.sandboxed) {
      const hook = await getHook(options.projectPath || options.cwd, 'sandbox-setup');
      return await limaPlugin.spawnSandboxedPty(options, mainWindow, hook?.command);
    }
    return await spawnPty(options, mainWindow);
  });

  ipcMain.on('pty:write', (_event, ptyId: string, data: string) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.writeSandboxPty(ptyId, data);
    } else {
      writeToPty(ptyId, data);
    }
  });

  ipcMain.on('pty:resize', (_event, ptyId: string, cols: number, rows: number) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.resizeSandboxPty(ptyId, cols, rows);
    } else {
      resizePty(ptyId, cols, rows);
    }
  });

  ipcMain.on('pty:kill', (_event, ptyId: string) => {
    if (limaPlugin.isSandboxPty(ptyId)) {
      limaPlugin.killSandboxPty(ptyId);
    } else {
      killPty(ptyId);
    }
  });

  // Get active PTY sessions (for reconnection after renderer reload)
  ipcMain.handle('pty:get-active-sessions', () => {
    return getActiveSessions();
  });

  // Reconnect to an existing PTY after renderer reload
  ipcMain.handle('pty:reconnect', (_event, ptyId: string) => {
    return reconnectPty(ptyId, mainWindow);
  });

  // Update window reference (called when renderer reconnects)
  ipcMain.on('pty:set-window', () => {
    setWindow(mainWindow);
  });

  // Refresh projects (re-scan)
  ipcMain.handle('refresh-projects', async () => {
    try {
      const projects = await scanForProjects();
      return projects;
    } catch (error) {
      console.error('Error refreshing projects:', error);
      throw error;
    }
  });

  // Get git status for a project
  ipcMain.handle('get-git-status', async (_event, projectPath: string): Promise<GitStatus | null> => {
    return getGitStatus(projectPath);
  });

  // Get compact git status for at-a-glance display
  ipcMain.handle('get-compact-git-status', async (_event, projectPath: string): Promise<CompactGitStatus | null> => {
    return getCompactGitStatus(projectPath);
  });

  // Get extended git dropdown info for a project
  ipcMain.handle('get-git-dropdown-info', async (_event, projectPath: string): Promise<GitDropdownInfo | null> => {
    return getGitDropdownInfo(projectPath);
  });

  // Checkout a git branch
  ipcMain.handle('git-checkout', async (_event, projectPath: string, branchName: string) => {
    return checkoutBranch(projectPath, branchName);
  });

  // Create a new git branch
  ipcMain.handle('git-create-branch', async (_event, projectPath: string, branchName: string) => {
    return createBranch(projectPath, branchName);
  });

  // Merge current branch into main
  ipcMain.handle('git-merge-into-main', async (_event, projectPath: string) => {
    return mergeIntoMain(projectPath);
  });

  // Get list of changed files
  ipcMain.handle('get-changed-files', async (_event, projectPath: string): Promise<ChangedFile[]> => {
    return getChangedFiles(projectPath);
  });

  // Get diff for a specific file
  ipcMain.handle('get-file-diff', async (_event, projectPath: string, filePath: string): Promise<FileDiff | null> => {
    return getFileDiff(projectPath, filePath);
  });

  // Create a new project
  ipcMain.handle('create-project', async (_event, options: CreateProjectOptions): Promise<CreateProjectResult> => {
    try {
      const projectsDir = path.join(os.homedir(), 'Ouijit', 'projects');
      const projectPath = path.join(projectsDir, options.name);

      // Check if project already exists
      try {
        await fs.access(projectPath);
        return { success: false, error: 'A project with this name already exists' };
      } catch {
        // Directory doesn't exist, which is what we want
      }

      // Ensure the projects directory exists
      await fs.mkdir(projectsDir, { recursive: true });

      // Create the project directory
      await fs.mkdir(projectPath);

      // Initialize git
      try {
        execSync('git init', { cwd: projectPath, stdio: 'ignore' });
      } catch (gitError) {
        console.warn('Failed to initialize git:', gitError);
        // Continue anyway - git init failing shouldn't block project creation
      }

      // Create CLAUDE.md
      const claudeMdContent = `# ${options.name}

## Project Overview

<!-- Describe your project here -->

## Development Guidelines

<!-- Add guidelines for Claude to follow -->
`;
      await fs.writeFile(path.join(projectPath, 'CLAUDE.md'), claudeMdContent, 'utf-8');

      return { success: true, projectPath };
    } catch (error) {
      console.error('Error creating project:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });

  // Show native folder picker dialog
  ipcMain.handle('show-folder-picker', async () => {
    try {
      // Use focused window as fallback in case mainWindow reference is stale
      const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
      const result = await dialog.showOpenDialog(targetWindow, {
        properties: ['openDirectory'],
        title: 'Add Project Folder',
        buttonLabel: 'Add Project',
      });
      return {
        canceled: result.canceled,
        filePaths: result.filePaths,
      };
    } catch (error) {
      console.error('Error showing folder picker:', error);
      return { canceled: true, filePaths: [] };
    }
  });

  // Add a project folder to the persisted list
  ipcMain.handle('add-project', async (_event, folderPath: string) => {
    return addProject(folderPath);
  });

  // Remove a project folder from the persisted list
  ipcMain.handle('remove-project', async (_event, folderPath: string) => {
    return removeProject(folderPath);
  });

  // Get list of manually added projects
  ipcMain.handle('get-added-projects', async () => {
    return getAddedProjects();
  });

  // Get project settings
  ipcMain.handle('get-project-settings', async (_event, projectPath: string): Promise<ProjectSettings> => {
    return getProjectSettings(projectPath);
  });

  // Worktree handlers
  ipcMain.handle('worktree:create', async (_event, projectPath: string, name?: string, prompt?: string): Promise<TaskWorktreeResult> => {
    return createTaskWorktree(projectPath, name, prompt);
  });

  ipcMain.handle('worktree:remove', async (_event, projectPath: string, worktreePath: string): Promise<WorktreeRemoveResult> => {
    return removeTaskWorktree(projectPath, worktreePath);
  });

  ipcMain.handle('worktree:list', async (_event, projectPath: string): Promise<WorktreeInfo[]> => {
    return listWorktrees(projectPath);
  });

  ipcMain.handle('worktree:get-diff', async (_event, projectPath: string, worktreeBranch: string, targetBranch?: string): Promise<WorktreeDiffSummary | null> => {
    return getWorktreeDiff(projectPath, worktreeBranch, targetBranch);
  });

  ipcMain.handle('worktree:get-file-diff', async (_event, projectPath: string, worktreeBranch: string, filePath: string, targetBranch?: string): Promise<FileDiff | null> => {
    return getWorktreeFileDiff(projectPath, worktreeBranch, filePath, targetBranch);
  });

  ipcMain.handle('worktree:merge', async (_event, projectPath: string, worktreeBranch: string): Promise<GitMergeResult> => {
    return mergeWorktreeBranch(projectPath, worktreeBranch);
  });

  // Ship a worktree branch (merge into target branch and close task)
  ipcMain.handle('worktree:ship', async (_event, projectPath: string, worktreeBranch: string, commitMessage?: string): Promise<{ success: boolean; error?: string; conflictFiles?: string[]; mergedBranch?: string }> => {
    // First, check for uncommitted changes in the worktree
    const worktrees = listWorktrees(projectPath);
    const worktree = worktrees.find(wt => wt.branch === worktreeBranch);

    if (worktree) {
      try {
        const status = execSync('git status --porcelain', {
          cwd: worktree.path,
          encoding: 'utf8',
        });
        if (status.trim().length > 0) {
          return {
            success: false,
            error: 'Uncommitted changes in worktree. Commit or stash first.',
          };
        }
      } catch {
        // Ignore check errors and proceed
      }
    }

    // Get the merge target from task metadata
    const task = await getTask(projectPath, worktreeBranch);
    const targetBranch = task?.mergeTarget;

    // Attempt to merge
    const result = mergeWorktreeBranch(projectPath, worktreeBranch, commitMessage, targetBranch);

    if (!result.success && result.error?.includes('conflict')) {
      // Try to get conflicting files (note: merge was already aborted by mergeWorktreeBranch)
      // Since the merge was aborted, we can't get the conflict files directly
      // Return a generic message about conflicts
      return {
        success: false,
        error: result.error,
        conflictFiles: [], // Files are unknown after abort
      };
    }

    return result;
  });

  // Get tasks with metadata merged with worktree list
  ipcMain.handle('worktree:get-tasks', async (_event, projectPath: string): Promise<WorktreeWithMetadata[]> => {
    const worktrees = listWorktrees(projectPath);
    const tasks = await getProjectTasks(projectPath);

    // Create a map for quick lookup
    const taskMap = new Map(tasks.map(t => [t.branch, t]));

    // For each worktree, ensure metadata exists and merge
    const results: WorktreeWithMetadata[] = [];
    for (const wt of worktrees) {
      let metadata = taskMap.get(wt.branch);
      if (!metadata) {
        // Create metadata for worktrees that don't have it yet
        const displayName = formatBranchNameForDisplay(wt.branch);
        metadata = await ensureTaskExists(projectPath, wt.branch, displayName);
      }

      results.push({
        path: wt.path,
        branch: wt.branch,
        taskName: metadata.name,
        createdAt: metadata.createdAt || wt.createdAt,
        taskNumber: metadata.taskNumber,
        name: metadata.name,
        status: metadata.status,
        closedAt: metadata.closedAt,
        readyToShip: metadata.readyToShip,
        mergeTarget: metadata.mergeTarget,
        prompt: metadata.prompt,
        sandboxed: metadata.sandboxed,
      });
    }

    // Also include closed tasks that might not have worktrees anymore
    // (though in our design they should always have worktrees)
    for (const task of tasks) {
      if (!results.some(r => r.branch === task.branch)) {
        // Task exists in metadata but no worktree - might be orphaned
        // Include it anyway for visibility
        results.push({
          path: '',
          branch: task.branch,
          taskName: task.name,
          createdAt: task.createdAt,
          taskNumber: task.taskNumber,
          name: task.name,
          status: task.status,
          closedAt: task.closedAt,
          readyToShip: task.readyToShip,
          mergeTarget: task.mergeTarget,
          prompt: task.prompt,
          sandboxed: task.sandboxed,
        });
      }
    }

    // Sort: open first, then by creation date (newest first)
    return results.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'open' ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  });

  // Mark a task as closed
  ipcMain.handle('worktree:close', async (_event, projectPath: string, branch: string): Promise<{ success: boolean; error?: string; hookWarning?: string }> => {
    let hookWarning: string | undefined;

    // Run cleanup hook if configured
    const cleanupHook = await getHook(projectPath, 'cleanup');
    if (cleanupHook) {
      // Find the worktree path for this branch
      const worktrees = listWorktrees(projectPath);
      const worktree = worktrees.find(wt => wt.branch === branch);
      const task = await getTask(projectPath, branch);

      if (worktree) {
        const hookResult = await executeHook(cleanupHook, worktree.path, {
          projectPath,
          worktreePath: worktree.path,
          taskBranch: branch,
          taskName: task?.name || branch,
        });

        if (!hookResult.success) {
          // Truncate output BEFORE logging to prevent sensitive data exposure in logs
          const warningMessage = hookResult.error || hookResult.output;
          const truncatedMessage = warningMessage && warningMessage.length > 500
            ? warningMessage.slice(0, 500) + '...'
            : warningMessage;
          // Log only truncated message
          console.warn(`Cleanup hook failed for ${branch}: ${truncatedMessage}`);
          hookWarning = truncatedMessage;
        }
      }
    }

    const closeResult = await closeTask(projectPath, branch);
    return {
      ...closeResult,
      hookWarning,
    };
  });

  // Reopen a closed task
  ipcMain.handle('worktree:reopen', async (_event, projectPath: string, branch: string): Promise<{ success: boolean; error?: string }> => {
    return reopenTask(projectPath, branch);
  });

  // Set task ready-to-ship state
  ipcMain.handle('worktree:set-ready', async (_event, projectPath: string, branch: string, ready: boolean): Promise<{ success: boolean; error?: string }> => {
    return setTaskReadyToShip(projectPath, branch, ready);
  });

  // List all branches in the project
  ipcMain.handle('worktree:list-branches', async (_event, projectPath: string): Promise<BranchInfo[]> => {
    return listBranches(projectPath);
  });

  // Set task merge target
  ipcMain.handle('worktree:set-merge-target', async (_event, projectPath: string, branch: string, mergeTarget: string): Promise<{ success: boolean; error?: string }> => {
    return setTaskMergeTarget(projectPath, branch, mergeTarget);
  });

  // Set task sandboxed state
  ipcMain.handle('worktree:set-sandboxed', async (_event, projectPath: string, branch: string, sandboxed: boolean): Promise<{ success: boolean; error?: string }> => {
    return setTaskSandboxed(projectPath, branch, sandboxed);
  });

  // Get the main branch for a project
  ipcMain.handle('worktree:get-main-branch', async (_event, projectPath: string): Promise<string> => {
    return getMainBranch(projectPath);
  });

  // Hook handlers
  ipcMain.handle('hooks:get', async (_event, projectPath: string) => {
    return getHooks(projectPath);
  });

  ipcMain.handle('hooks:save', async (_event, projectPath: string, hook: ScriptHook) => {
    return saveHook(projectPath, hook);
  });

  ipcMain.handle('hooks:delete', async (_event, projectPath: string, hookType: HookType) => {
    return deleteHook(projectPath, hookType);
  });

  // Project settings handlers
  ipcMain.handle('settings:set-kill-existing-on-run', async (_event, projectPath: string, kill: boolean) => {
    return setKillExistingOnRun(projectPath, kill);
  });
}

/**
 * Cleanup function to be called when app is quitting
 */
export function cleanupIpc(): void {
  cleanupAllPtys();
  limaPlugin.cleanup();
}
