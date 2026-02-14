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
import { createTaskWorktree, createTodoTask, startTask, removeTaskWorktree, listWorktrees, validateBranchName, generateBranchName } from './worktree';
import type { TaskWorktreeResult, WorktreeRemoveResult, WorktreeInfo } from './worktree';
import {
  getProjectTasks,
  getNextTaskNumber,
  setTaskStatus,
  setTaskMergeTarget,
  setTaskSandboxed,
  deleteTaskByNumber,
  getTask,
  getTaskByNumber,
  type TaskStatus,
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
import type { PtySpawnOptions, CreateProjectOptions, CreateProjectResult, ProjectSettings, GitStatus, CompactGitStatus, GitDropdownInfo, ChangedFile, FileDiff, WorktreeDiffSummary, GitMergeResult, TaskWithWorkspace, ScriptHook, HookType, BranchInfo } from './types';

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

  // Handler to open a URL in the default browser
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
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

  // Worktree handlers (git plumbing — task ops are on task:* namespace)
  ipcMain.handle('worktree:validate-branch-name', async (_event, projectPath: string, branchName: string): Promise<{ valid: boolean; error?: string }> => {
    return validateBranchName(projectPath, branchName);
  });

  ipcMain.handle('worktree:generate-branch-name', async (_event, projectPath: string, name: string): Promise<string> => {
    const taskNumber = await getNextTaskNumber(projectPath);
    return generateBranchName(name, taskNumber);
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

  // List all branches in the project
  ipcMain.handle('worktree:list-branches', async (_event, projectPath: string): Promise<BranchInfo[]> => {
    return listBranches(projectPath);
  });

  // Get the main branch for a project
  ipcMain.handle('worktree:get-main-branch', async (_event, projectPath: string): Promise<string> => {
    return getMainBranch(projectPath);
  });

  // ---- Task lifecycle handlers (new task:* namespace) ----

  ipcMain.handle('task:create', async (_event, projectPath: string, name?: string, prompt?: string): Promise<TaskWorktreeResult> => {
    return createTodoTask(projectPath, name, prompt);
  });

  ipcMain.handle('task:create-and-start', async (_event, projectPath: string, name?: string, prompt?: string, branchName?: string): Promise<TaskWorktreeResult> => {
    return createTaskWorktree(projectPath, name, prompt, branchName);
  });

  ipcMain.handle('task:start', async (_event, projectPath: string, taskNumber: number, branchName?: string): Promise<TaskWorktreeResult> => {
    return startTask(projectPath, taskNumber, branchName);
  });

  ipcMain.handle('task:get-all', async (_event, projectPath: string): Promise<TaskWithWorkspace[]> => {
    const worktrees = listWorktrees(projectPath);
    const tasks = await getProjectTasks(projectPath);

    const worktreeMap = new Map(worktrees.map(wt => [wt.branch, wt]));

    return tasks.map(task => {
      const wt = task.branch ? worktreeMap.get(task.branch) : undefined;
      return {
        taskNumber: task.taskNumber,
        name: task.name,
        status: task.status,
        branch: task.branch,
        worktreePath: wt?.path || task.worktreePath,
        createdAt: task.createdAt,
        closedAt: task.closedAt,
        mergeTarget: task.mergeTarget,
        prompt: task.prompt,
        sandboxed: task.sandboxed,
      };
    });
  });

  ipcMain.handle('task:get-by-number', async (_event, projectPath: string, taskNumber: number): Promise<TaskWithWorkspace | null> => {
    const task = await getTaskByNumber(projectPath, taskNumber);
    if (!task) return null;
    const worktrees = listWorktrees(projectPath);
    const wt = task.branch ? worktrees.find(w => w.branch === task.branch) : undefined;
    return {
      taskNumber: task.taskNumber,
      name: task.name,
      status: task.status,
      branch: task.branch,
      worktreePath: wt?.path || task.worktreePath,
      createdAt: task.createdAt,
      closedAt: task.closedAt,
      mergeTarget: task.mergeTarget,
      prompt: task.prompt,
      sandboxed: task.sandboxed,
    };
  });

  ipcMain.handle('task:set-status', async (_event, projectPath: string, taskNumber: number, status: TaskStatus): Promise<{ success: boolean; error?: string; hookWarning?: string }> => {
    let hookWarning: string | undefined;

    if (status === 'done') {
      const cleanupHook = await getHook(projectPath, 'cleanup');
      if (cleanupHook) {
        const task = await getTaskByNumber(projectPath, taskNumber);
        const worktrees = listWorktrees(projectPath);
        const worktree = task?.branch ? worktrees.find(wt => wt.branch === task.branch) : undefined;

        if (worktree && task) {
          const hookResult = await executeHook(cleanupHook, worktree.path, {
            projectPath,
            worktreePath: worktree.path,
            taskBranch: task.branch || '',
            taskName: task.name,
          });

          if (!hookResult.success) {
            const warningMessage = hookResult.error || hookResult.output;
            const truncatedMessage = warningMessage && warningMessage.length > 500
              ? warningMessage.slice(0, 500) + '...'
              : warningMessage;
            hookWarning = truncatedMessage;
          }
        }
      }
    }

    const result = await setTaskStatus(projectPath, taskNumber, status);
    return { ...result, hookWarning };
  });

  ipcMain.handle('task:delete', async (_event, projectPath: string, taskNumber: number): Promise<{ success: boolean; error?: string }> => {
    const task = await getTaskByNumber(projectPath, taskNumber);
    if (task?.worktreePath || task?.branch) {
      const worktrees = listWorktrees(projectPath);
      const wt = task.branch
        ? worktrees.find(w => w.branch === task.branch)
        : worktrees.find(w => w.path === task.worktreePath);
      if (wt) {
        const removeResult = await removeTaskWorktree(projectPath, wt.path);
        if (!removeResult.success) return removeResult;
        return { success: true };
      }
    }
    return deleteTaskByNumber(projectPath, taskNumber);
  });

  ipcMain.handle('task:set-merge-target', async (_event, projectPath: string, taskNumber: number, mergeTarget: string): Promise<{ success: boolean; error?: string }> => {
    return setTaskMergeTarget(projectPath, taskNumber, mergeTarget);
  });

  ipcMain.handle('task:set-sandboxed', async (_event, projectPath: string, taskNumber: number, sandboxed: boolean): Promise<{ success: boolean; error?: string }> => {
    return setTaskSandboxed(projectPath, taskNumber, sandboxed);
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
