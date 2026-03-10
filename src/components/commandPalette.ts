/**
 * Command Palette — quick terminal switcher (Cmd+K)
 *
 * Fuzzy-search across all terminals to jump to any terminal.
 */

import { OuijitTerminal } from './terminal';
import { getManager } from './terminal';
import { pushScope, popScope, Scopes } from '../utils/hotkeys';
import { projectPath, homeViewActive } from './project/signals';
import { enterProjectMode, exitProjectMode } from './project/projectMode';
import { exitHomeView } from './homeView';
import { updateSidebarActiveState } from './sidebar';

// ── Types ────────────────────────────────────────────────────────────

interface PaletteItem {
  terminal: OuijitTerminal;
  projectPath: string;
  projectName: string;
  label: string;
  searchText: string;
}

// ── State ────────────────────────────────────────────────────────────

let paletteVisible = false;
let overlayEl: HTMLElement | null = null;
let selectedIndex = 0;
let filteredItems: PaletteItem[] = [];
let allItems: PaletteItem[] = [];
let activating = false;

// ── Public API ───────────────────────────────────────────────────────

export function toggleCommandPalette(): void {
  if (paletteVisible) {
    hideCommandPalette();
  } else {
    showCommandPalette();
  }
}

export function hideCommandPalette(): void {
  if (!paletteVisible) return;
  paletteVisible = false;

  popScope();

  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }

  // Refocus active terminal
  const manager = getManager();
  const active = manager.activeTerminal.value;
  if (active) {
    requestAnimationFrame(() => active.xterm.focus());
  }
}

// ── Gather terminals ─────────────────────────────────────────────────

function gatherAllTerminals(): PaletteItem[] {
  const manager = getManager();
  const items: PaletteItem[] = [];
  const seen = new Set<OuijitTerminal>();

  // Active project terminals
  for (const term of manager.terminals.value) {
    if (term.isSplitPane) continue;
    seen.add(term);
    const name = projectName(term.projectPath);
    const label = term.customLabel ?? term.label.value;
    items.push({
      terminal: term,
      projectPath: term.projectPath,
      projectName: name,
      label,
      searchText: `${name} ${label} ${term.worktreeBranch ?? ''} ${term.tags.value.join(' ')}`.toLowerCase(),
    });
  }

  // Preserved session terminals
  for (const [path, session] of manager.sessions) {
    for (const term of session.terminals) {
      if (seen.has(term) || term.isSplitPane) continue;
      seen.add(term);
      const name = session.projectData.name;
      const label = term.customLabel ?? term.label.value;
      items.push({
        terminal: term,
        projectPath: path,
        projectName: name,
        label,
        searchText: `${name} ${label} ${term.worktreeBranch ?? ''} ${term.tags.value.join(' ')}`.toLowerCase(),
      });
    }
  }

  return items;
}

function projectName(path: string): string {
  const manager = getManager();
  const session = manager.sessions.get(path);
  if (session) return session.projectData.name;
  return path.split('/').pop() ?? path;
}

// ── Fuzzy matching ───────────────────────────────────────────────────

export function fuzzyMatch(query: string, text: string): number {
  if (!query) return 1; // Empty query matches everything
  const q = query.toLowerCase();
  let score = 0;
  let qi = 0;

  for (let ti = 0; ti < text.length && qi < q.length; ti++) {
    if (text[ti] === q[qi]) {
      score += 1;
      // Bonus for consecutive matches
      if (ti > 0 && text[ti - 1] === q[qi - 1]) score += 2;
      // Bonus for match at word boundary
      if (ti === 0 || text[ti - 1] === ' ' || text[ti - 1] === '/') score += 3;
      qi++;
    }
  }

  return qi === q.length ? score : -1;
}

// ── Show ─────────────────────────────────────────────────────────────

function showCommandPalette(): void {
  if (paletteVisible) return;
  paletteVisible = true;

  allItems = gatherAllTerminals();
  filteredItems = [...allItems];
  selectedIndex = 0;

  // Create overlay
  overlayEl = document.createElement('div');
  overlayEl.className = 'command-palette-overlay';

  const palette = document.createElement('div');
  palette.className = 'command-palette';

  // Search input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'command-palette-input';
  input.placeholder = 'Switch to terminal\u2026';
  palette.appendChild(input);

  // Results container
  const results = document.createElement('div');
  results.className = 'command-palette-results';
  palette.appendChild(results);

  overlayEl.appendChild(palette);
  document.body.appendChild(overlayEl);

  // Push modal scope
  pushScope(Scopes.MODAL);

  // Render initial results
  renderResults(results);

  // Focus input
  requestAnimationFrame(() => input.focus());

  // Wire events
  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (!query) {
      filteredItems = [...allItems];
    } else {
      const scored = allItems
        .map(item => ({ item, score: fuzzyMatch(query, item.searchText) }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score);
      filteredItems = scored.map(s => s.item);
    }
    selectedIndex = 0;
    renderResults(results);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1);
      renderResults(results);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderResults(results);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems.length > 0) {
        activateItem(filteredItems[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideCommandPalette();
    }
  });

  // Click outside to dismiss
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) {
      hideCommandPalette();
    }
  });
}

// ── Rendering ────────────────────────────────────────────────────────

function renderResults(container: HTMLElement): void {
  container.innerHTML = '';

  if (filteredItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'command-palette-empty';
    empty.textContent = 'No matching terminals';
    container.appendChild(empty);
    return;
  }

  filteredItems.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'command-palette-result';
    if (index === selectedIndex) row.classList.add('command-palette-result--selected');

    // Status dot
    const dot = document.createElement('span');
    dot.className = 'project-card-status-dot';
    dot.setAttribute('data-status', item.terminal.summaryType.value);
    row.appendChild(dot);

    // Project badge
    const badge = document.createElement('span');
    badge.className = 'command-palette-project-badge';
    badge.textContent = item.projectName;
    row.appendChild(badge);

    // Label
    const label = document.createElement('span');
    label.className = 'command-palette-label';
    label.textContent = item.label;
    row.appendChild(label);

    // Branch (if available)
    if (item.terminal.worktreeBranch) {
      const branch = document.createElement('span');
      branch.className = 'command-palette-branch';
      branch.textContent = item.terminal.worktreeBranch;
      row.appendChild(branch);
    }

    // Tags
    if (item.terminal.tags.value.length > 0) {
      const tags = document.createElement('span');
      tags.className = 'command-palette-tags';
      tags.textContent = item.terminal.tags.value.join(', ');
      row.appendChild(tags);
    }

    row.addEventListener('click', () => activateItem(item));
    row.addEventListener('mouseenter', () => {
      selectedIndex = index;
      container.querySelectorAll('.command-palette-result').forEach((r, i) =>
        r.classList.toggle('command-palette-result--selected', i === index)
      );
    });

    container.appendChild(row);
  });

  // Scroll selected into view
  const selected = container.querySelector('.command-palette-result--selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

// ── Activation ───────────────────────────────────────────────────────

async function activateItem(item: PaletteItem): Promise<void> {
  // Guard against rapid double-activation
  if (activating) return;
  activating = true;

  hideCommandPalette();

  try {
    const manager = getManager();

    // Check if terminal is in current project's active terminals
    const activeIdx = manager.terminals.value.indexOf(item.terminal);
    if (activeIdx !== -1) {
      manager.switchToIndex(activeIdx);
      return;
    }

    // Check if target is already the current project (terminal is in its session)
    if (item.projectPath === projectPath.value) {
      // Terminal belongs to this project but isn't in active terminals —
      // this shouldn't normally happen, but handle gracefully
      return;
    }

    // Terminal is in a different project's preserved session
    const targetPath = item.projectPath;
    const session = manager.sessions.get(targetPath);
    if (!session) return;

    // Pre-set the session's active index to the target terminal
    const termIdx = session.terminals.indexOf(item.terminal);
    if (termIdx !== -1) {
      session.activeIndex = termIdx;
    }

    // Exit current view
    if (homeViewActive.value) {
      exitHomeView();
    } else if (projectPath.value !== null) {
      exitProjectMode();
    }

    // Enter target project
    await enterProjectMode(targetPath, session.projectData);

    // Switch to the target terminal after entering project mode
    requestAnimationFrame(() => {
      const newIdx = manager.terminals.value.indexOf(item.terminal);
      if (newIdx !== -1) {
        manager.switchToIndex(newIdx);
      }
    });

    updateSidebarActiveState();
  } finally {
    activating = false;
  }
}
