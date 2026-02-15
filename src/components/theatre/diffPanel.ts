/**
 * Diff panel for viewing uncommitted changes in theatre mode
 * Provides shared rendering functions used by both diff panel and ship-it panel
 */

import type { ChangedFile, FileDiff } from '../../types';
import { TheatreTerminal } from './state';
import { getTerminalGitPath, hideRunnerPanel, theatreRegistry } from './helpers';
import {
  projectPath,
  terminals,
  activeIndex,
  diffPanelVisible,
  diffPanelFiles,
  diffPanelSelectedFile,
  diffPanelMode,
  diffPanelTaskId,
} from './signals';
import { escapeHtml } from '../../utils/html';
import { showToast } from '../importDialog';

/**
 * Format diff stats as HTML
 */
export function formatDiffStats(additions: number, deletions: number): string {
  const parts: string[] = [];
  if (additions > 0) parts.push(`<span class="diff-stat-add">+${additions}</span>`);
  if (deletions > 0) parts.push(`<span class="diff-stat-del">-${deletions}</span>`);
  return parts.length > 0 ? parts.join(' ') : '';
}

// ==========================================
// Shared rendering functions
// ==========================================

/**
 * Get the Lucide icon name and CSS class for a file change status
 */
function fileStatusIcon(status: string): { icon: string; cls: string } {
  switch (status) {
    case 'A': case '?': return { icon: 'file-plus', cls: 'diff-file-icon--added' };
    case 'D': return { icon: 'file-minus', cls: 'diff-file-icon--deleted' };
    case 'R': return { icon: 'file-pen', cls: 'diff-file-icon--renamed' };
    default:  return { icon: 'file-diff', cls: 'diff-file-icon--modified' };
  }
}

/**
 * Build a nested directory tree from a flat list of file paths.
 * Returns HTML with toggleable directories and file leaf nodes.
 */
export function buildFileListHtml(files: ChangedFile[]): string {
  // Build tree structure
  interface TreeNode {
    name: string;
    children: Map<string, TreeNode>;
    file?: ChangedFile;
  }
  const root: TreeNode = { name: '', children: new Map() };

  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children.has(parts[i])) {
        node.children.set(parts[i], { name: parts[i], children: new Map() });
      }
      node = node.children.get(parts[i])!;
    }
    const fileName = parts[parts.length - 1];
    const leaf: TreeNode = { name: fileName, children: new Map(), file };
    node.children.set(file.path, leaf); // use full path as key to avoid name collisions
  }

  // Collapse single-child directory chains (e.g. src/components -> src/components)
  function collapse(node: TreeNode): TreeNode {
    for (const [key, child] of node.children) {
      if (!child.file && child.children.size === 1) {
        const [grandKey, grandChild] = [...child.children.entries()][0];
        if (!grandChild.file) {
          // Merge: child/grandchild -> "child/grandchild"
          const merged: TreeNode = { name: `${child.name}/${grandChild.name}`, children: grandChild.children };
          node.children.delete(key);
          node.children.set(grandKey, collapse(merged));
          continue;
        }
      }
      node.children.set(key, collapse(child));
    }
    return node;
  }
  collapse(root);

  // Render tree to HTML
  function renderNode(node: TreeNode, depth: number): string {
    // Sort: directories first, then files, alphabetically within each group
    const entries = [...node.children.values()].sort((a, b) => {
      const aIsDir = !a.file ? 0 : 1;
      const bIsDir = !b.file ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return a.name.localeCompare(b.name);
    });

    return entries.map(child => {
      if (child.file) {
        const { icon, cls } = fileStatusIcon(child.file.status);
        const stats = formatDiffStats(child.file.additions, child.file.deletions);
        return `<div class="diff-tree-file" data-path="${escapeHtml(child.file.path)}" style="padding-left:${12 + depth * 12}px">
          <i data-lucide="${icon}" class="diff-file-icon ${cls}"></i>
          <span class="diff-tree-name">${escapeHtml(child.name)}</span>
          <span class="diff-panel-file-stats">${stats}</span>
        </div>`;
      }
      // Directory node
      const childrenHtml = renderNode(child, depth + 1);
      return `<div class="diff-tree-dir" data-expanded="true">
        <div class="diff-tree-dir-label" style="padding-left:${12 + depth * 12}px">
          <i data-lucide="chevron-down" class="diff-tree-chevron"></i>
          <span class="diff-tree-name">${escapeHtml(child.name)}</span>
        </div>
        <div class="diff-tree-dir-children">${childrenHtml}</div>
      </div>`;
    }).join('');
  }

  return renderNode(root, 0);
}

/**
 * Build stacked diff sections HTML (one section per file)
 * Each section starts with a loading placeholder that gets replaced by loadAllDiffs
 */
export function buildStackedDiffsHtml(files: ChangedFile[]): string {
  return files.map(file => {
    const stats = formatDiffStats(file.additions, file.deletions);
    return `
      <div class="diff-file-section" data-path="${escapeHtml(file.path)}">
        <div class="diff-file-section-header">
          <span class="diff-file-section-name" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span>
          <span class="diff-file-section-stats">${stats}</span>
        </div>
        <div class="diff-file-section-body">
          <div class="diff-empty-state">Loading...</div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Fetch all diffs concurrently and fill section bodies as results arrive
 * @param panel - The panel element containing .diff-file-section elements
 * @param files - The changed files to fetch diffs for
 * @param fetchDiff - Async function that fetches a single file's diff
 */
export async function loadAllDiffs(
  panel: Element,
  files: ChangedFile[],
  fetchDiff: (filePath: string) => Promise<FileDiff | null>
): Promise<void> {
  const promises = files.map(async (file) => {
    const section = panel.querySelector(`.diff-file-section[data-path="${CSS.escape(file.path)}"]`);
    const body = section?.querySelector('.diff-file-section-body');
    if (!body) return;

    try {
      const diff = await fetchDiff(file.path);
      if (diff) {
        body.innerHTML = renderDiffContentHtml(diff);
      } else {
        body.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
      }
    } catch {
      body.innerHTML = '<div class="diff-empty-state">Unable to load diff</div>';
    }
  });

  await Promise.all(promises);
}

/**
 * Wire sidebar navigation - collapse toggle, directory toggling, file click-to-scroll
 */
export function wireSidebarNavigation(panel: Element): void {
  const fileList = panel.querySelector('.diff-panel-file-list');
  if (!fileList) return;

  // Sidebar collapse toggle (button lives in the header bar)
  const sidebar = fileList.closest('.diff-panel-sidebar, .ship-it-left');
  const root = panel.closest('.diff-panel, .ship-it-panel') ?? panel;
  const toggleBtn = root.querySelector('.diff-sidebar-toggle');
  if (sidebar && toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      toggleBtn.classList.toggle('collapsed', collapsed);
    });
  }

  // Directory toggle
  fileList.querySelectorAll('.diff-tree-dir-label').forEach(label => {
    label.addEventListener('click', () => {
      const dir = label.closest('.diff-tree-dir');
      if (!dir) return;
      const expanded = dir.getAttribute('data-expanded') === 'true';
      dir.setAttribute('data-expanded', expanded ? 'false' : 'true');
    });
  });

  // File click -> scroll to section
  fileList.querySelectorAll('.diff-tree-file').forEach(item => {
    item.addEventListener('click', () => {
      const path = (item as HTMLElement).dataset.path;
      if (!path) return;

      const section = panel.querySelector(`.diff-file-section[data-path="${CSS.escape(path)}"]`);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}


// ==========================================
// Diff content rendering
// ==========================================

/**
 * Render diff content HTML from FileDiff
 */
export function renderDiffContentHtml(diff: FileDiff): string {
  if (!diff.hunks.length) {
    return '<div class="diff-empty-state">No changes to display</div>';
  }

  const hunksHtml = diff.hunks.map(hunk => {
    const linesHtml = hunk.lines.map(line => {
      const oldNum = line.oldLineNo !== undefined ? line.oldLineNo : '';
      const newNum = line.newLineNo !== undefined ? line.newLineNo : '';
      return `
        <div class="diff-line diff-line--${line.type}">
          <div class="diff-line-numbers">
            <span class="diff-line-number">${oldNum}</span>
            <span class="diff-line-number">${newNum}</span>
          </div>
          <span class="diff-line-content">${escapeHtml(line.content)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="diff-hunk">
        <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
        ${linesHtml}
      </div>
    `;
  }).join('');

  return `<div class="diff-hunks-wrapper">${hunksHtml}</div>`;
}

// ==========================================
// Diff panel layout (new stacked design)
// ==========================================

/**
 * Build HTML for the diff panel with sidebar + stacked diffs
 */
export function buildDiffPanelHtml(files: ChangedFile[]): string {
  const fileListHtml = buildFileListHtml(files);
  const stackedDiffsHtml = buildStackedDiffsHtml(files);

  return `
    <div class="diff-panel">
      <div class="diff-panel-sidebar">
        <div class="diff-panel-file-list">
          ${fileListHtml}
        </div>
      </div>
      <div class="diff-panel-main">
        <div class="diff-content-header">
          <button class="diff-sidebar-toggle" title="Toggle file list">
            <i data-lucide="chevron-left" class="diff-sidebar-toggle-icon"></i>
          </button>
          <span class="diff-header-info"></span>
          <button class="diff-panel-close" title="Close diff panel"><i data-lucide="x"></i></button>
        </div>
        <div class="diff-content-body">
          ${stackedDiffsHtml}
        </div>
      </div>
    </div>
  `;
}

// ==========================================
// Panel helpers
// ==========================================

/**
 * Refit the active terminal after panel animation
 */
function refitActiveTerminal(): void {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;
  if (currentTerminals.length > 0 && currentActiveIndex < currentTerminals.length) {
    const active = currentTerminals[currentActiveIndex];
    active.fitAddon.fit();
    window.api.pty.resize(active.ptyId, active.terminal.cols, active.terminal.rows);
  }
}

/**
 * Wire up a diff panel's close button and sidebar navigation
 */
function wireDiffPanel(
  panel: Element,
  onClose: () => void
): void {
  // Wire close button
  const closeBtn = panel.querySelector('.diff-panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', onClose);
  }

  // Wire sidebar navigation
  wireSidebarNavigation(panel);
}

// ==========================================
// Show/hide diff panel (per-terminal)
// ==========================================

/**
 * Show the diff panel for a specific terminal (uncommitted changes)
 */
export async function showTerminalDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) return;

  // Close runner panel if open (mutual exclusivity)
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  }

  const gitPath = getTerminalGitPath(term);

  // Fetch changed files for this terminal's git context
  const files = await window.api.getChangedFiles(gitPath);
  if (!files.length) {
    showToast('No uncommitted changes', 'info');
    return;
  }

  // Store state on the terminal
  term.diffPanelOpen = true;
  term.diffPanelFiles = files;
  term.diffPanelMode = 'uncommitted';

  // Also update global signals for compatibility
  diffPanelFiles.value = files;
  diffPanelVisible.value = true;
  diffPanelMode.value = 'uncommitted';

  // Find the card body to insert the diff panel
  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Hide the terminal viewport (full width panel like ship panel)
  const viewport = cardBody.querySelector('.terminal-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.display = 'none';
  }

  // Create and insert panel inside the card body
  const panelHtml = buildDiffPanelHtml(files);
  cardBody.insertAdjacentHTML('beforeend', panelHtml);

  const panel = cardBody.querySelector('.diff-panel');
  if (!panel) return;

  // Add class to card to indicate diff is open
  term.container.classList.add('diff-panel-open');

  // Wire up panel interactions
  wireDiffPanel(panel, () => hideTerminalDiffPanel(term));

  // Update header info
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo) {
    const totalAdd = files.reduce((s, f) => s + f.additions, 0);
    const totalDel = files.reduce((s, f) => s + f.deletions, 0);
    headerInfo.innerHTML = `${files.length} file${files.length !== 1 ? 's' : ''} ${formatDiffStats(totalAdd, totalDel)}`;
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Load all diffs
  await loadAllDiffs(panel, files, (filePath) =>
    window.api.getFileDiff(gitPath, filePath)
  );
}

/**
 * Show the worktree diff panel for a specific terminal (branch vs main comparison)
 */
export async function showTerminalWorktreeDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen || term.taskId == null || !term.worktreeBranch) return;

  // Close runner panel if open (mutual exclusivity)
  if (term.runnerPanelOpen) {
    hideRunnerPanel(term);
  }

  const basePath = projectPath.value;
  if (!basePath) return;

  // Fetch worktree diff (branch vs main)
  const diffSummary = await window.api.worktree.getDiff(basePath, term.worktreeBranch);
  if (!diffSummary || !diffSummary.files.length) {
    showToast('No changes in worktree branch', 'info');
    return;
  }

  // Store state on the terminal
  term.diffPanelOpen = true;
  term.diffPanelFiles = diffSummary.files;
  term.diffPanelMode = 'worktree';

  // Also update global signals for compatibility
  diffPanelFiles.value = diffSummary.files;
  diffPanelVisible.value = true;
  diffPanelMode.value = 'worktree';
  diffPanelTaskId.value = term.taskId;

  // Find the card body to insert the diff panel
  const cardBody = term.container.querySelector('.theatre-card-body');
  if (!cardBody) return;

  // Hide the terminal viewport
  const viewport = cardBody.querySelector('.terminal-viewport') as HTMLElement;
  if (viewport) {
    viewport.style.display = 'none';
  }

  // Create and insert panel inside the card body
  const panelHtml = buildDiffPanelHtml(diffSummary.files);
  cardBody.insertAdjacentHTML('beforeend', panelHtml);

  const panel = cardBody.querySelector('.diff-panel');
  if (!panel) return;

  // Add class to card to indicate diff is open
  term.container.classList.add('diff-panel-open');

  // Wire up panel interactions
  wireDiffPanel(panel, () => hideTerminalDiffPanel(term));

  // Update header info
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo) {
    headerInfo.textContent = 'vs main';
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Load all diffs using worktree API
  await loadAllDiffs(panel, diffSummary.files, (filePath) =>
    window.api.worktree.getFileDiff(basePath, term.worktreeBranch!, filePath)
  );
}

/**
 * Hide the diff panel for a specific terminal
 */
export function hideTerminalDiffPanel(term: TheatreTerminal): void {
  if (!term.diffPanelOpen) return;

  // Find the panel inside the card
  const panel = term.container.querySelector('.diff-panel');
  if (panel) {
    panel.classList.remove('diff-panel--visible');
    // Remove after animation and restore terminal viewport
    setTimeout(() => {
      panel.remove();

      // Show the terminal viewport again
      const cardBody = term.container.querySelector('.theatre-card-body');
      const viewport = cardBody?.querySelector('.terminal-viewport') as HTMLElement;
      if (viewport) {
        viewport.style.display = '';
      }

      // Refit terminal
      requestAnimationFrame(() => {
        term.fitAddon.fit();
        window.api.pty.resize(term.ptyId, term.terminal.cols, term.terminal.rows);
        term.terminal.focus();
      });
    }, 250);
  }

  // Remove class from card
  term.container.classList.remove('diff-panel-open');

  // Update terminal state
  term.diffPanelOpen = false;
  term.diffPanelSelectedFile = null;
  term.diffPanelFiles = [];
  term.diffPanelMode = 'uncommitted';

  // Update global signals
  diffPanelVisible.value = false;
  diffPanelSelectedFile.value = null;
  diffPanelFiles.value = [];
  diffPanelMode.value = 'uncommitted';
  diffPanelTaskId.value = null;
}

/**
 * Toggle the diff panel for a specific terminal
 */
export async function toggleTerminalDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  } else {
    await showTerminalDiffPanel(term);
  }
}

/**
 * Toggle the worktree diff panel for a specific terminal
 */
export async function toggleTerminalWorktreeDiffPanel(term: TheatreTerminal): Promise<void> {
  if (term.diffPanelOpen) {
    hideTerminalDiffPanel(term);
  } else {
    await showTerminalWorktreeDiffPanel(term);
  }
}

// ==========================================
// Legacy global diff panel (show/hide/toggle)
// ==========================================

/**
 * Show the diff panel (global, legacy)
 */
export async function showDiffPanel(): Promise<void> {
  if (!projectPath.value || diffPanelVisible.value) return;

  // Fetch changed files
  const files = await window.api.getChangedFiles(projectPath.value);
  if (!files.length) {
    showToast('No uncommitted changes', 'info');
    return;
  }

  diffPanelFiles.value = files;
  diffPanelVisible.value = true;

  // Create and insert panel
  const panelHtml = buildDiffPanelHtml(files);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Wire up panel interactions
  wireDiffPanel(panel, () => hideDiffPanel());

  // Add class to theatre stack to shrink it
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.add('diff-panel-open');
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  // Load all diffs
  await loadAllDiffs(panel, files, (filePath) =>
    window.api.getFileDiff(projectPath.value!, filePath)
  );
}

/**
 * Hide the diff panel (global, legacy)
 */
export function hideDiffPanel(): void {
  if (!diffPanelVisible.value) return;

  const panel = document.querySelector('.diff-panel');
  if (panel) {
    panel.classList.remove('diff-panel--visible');
    // Remove after animation
    setTimeout(() => panel.remove(), 250);
  }

  // Remove class from theatre stack
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.remove('diff-panel-open');
  }

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  diffPanelVisible.value = false;
  diffPanelSelectedFile.value = null;
  diffPanelFiles.value = [];
  diffPanelMode.value = 'uncommitted';
  diffPanelTaskId.value = null;
}

/**
 * Toggle the diff panel visibility (global, legacy)
 */
export async function toggleDiffPanel(): Promise<void> {
  if (diffPanelVisible.value) {
    hideDiffPanel();
  } else {
    await showDiffPanel();
  }
}

/**
 * Show the worktree diff panel (global, legacy)
 * @deprecated Use showTerminalWorktreeDiffPanel for per-terminal worktree diff
 */
export async function showWorktreeDiffPanel(worktreeBranch: string): Promise<void> {
  if (!projectPath.value || diffPanelVisible.value) return;

  // Fetch worktree diff
  const diffSummary = await window.api.worktree.getDiff(projectPath.value, worktreeBranch);
  if (!diffSummary || !diffSummary.files.length) {
    showToast('No changes in worktree branch', 'info');
    return;
  }

  // Set mode before showing panel
  diffPanelMode.value = 'worktree';
  const allTasks = await window.api.task.getAll(projectPath.value);
  const matchedTask = allTasks.find(t => t.branch === worktreeBranch);
  diffPanelTaskId.value = matchedTask?.taskNumber ?? null;
  diffPanelFiles.value = diffSummary.files;
  diffPanelVisible.value = true;

  // Create and insert panel
  const panelHtml = buildDiffPanelHtml(diffSummary.files);
  document.body.insertAdjacentHTML('beforeend', panelHtml);

  const panel = document.querySelector('.diff-panel');
  if (!panel) return;

  // Wire up panel interactions
  wireDiffPanel(panel, () => hideDiffPanel());

  // Update header info
  const headerInfo = panel.querySelector('.diff-header-info');
  if (headerInfo) {
    headerInfo.textContent = 'vs main';
  }

  // Add class to theatre stack to shrink it
  const stack = document.querySelector('.theatre-stack');
  if (stack) {
    stack.classList.add('diff-panel-open');
  }

  // Animate panel in
  requestAnimationFrame(() => {
    panel.classList.add('diff-panel--visible');
  });

  // Refit active theatre terminal after animation
  setTimeout(() => refitActiveTerminal(), 250);

  // Load all diffs
  const basePath = projectPath.value;
  await loadAllDiffs(panel, diffSummary.files, (filePath) =>
    window.api.worktree.getFileDiff(basePath, worktreeBranch, filePath)
  );
}

// ==========================================
// Sync and toggle helpers
// ==========================================

/**
 * Sync the diff panel visibility based on the active terminal's state
 */
export function syncDiffPanelToActiveTerminal(): void {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];

  // Update global signals to match active terminal's state
  if (activeTerm.diffPanelOpen) {
    diffPanelFiles.value = activeTerm.diffPanelFiles;
    diffPanelSelectedFile.value = activeTerm.diffPanelSelectedFile;
    diffPanelVisible.value = true;
  } else {
    diffPanelVisible.value = false;
    diffPanelFiles.value = [];
    diffPanelSelectedFile.value = null;
  }

  // Only refit if the active terminal has a diff panel open
  if (activeTerm.diffPanelOpen) {
    setTimeout(() => refitActiveTerminal(), 50);
  }
}

/**
 * Toggle diff panel for the active terminal (hotkey handler)
 */
async function toggleActiveDiffPanel(): Promise<void> {
  const currentTerminals = terminals.value;
  const currentActiveIndex = activeIndex.value;

  if (currentTerminals.length === 0 || currentActiveIndex >= currentTerminals.length) {
    return;
  }

  const activeTerm = currentTerminals[currentActiveIndex];
  await toggleTerminalDiffPanel(activeTerm);
}

// Register in theatre registry for cross-module access
theatreRegistry.toggleActiveDiffPanel = toggleActiveDiffPanel;
