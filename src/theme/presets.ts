/**
 * Built-in preset themes — bundled CustomTheme definitions selectable without
 * any setup. A preset behaves exactly like a user custom theme (token
 * overrides on a built-in base) but ships with the app. A user theme saved
 * with the same id shadows the preset, so "editing" a preset really edits a
 * user copy; deleting that copy restores the preset.
 */

import type { CustomTheme } from './themes';

/** Dracula — https://draculatheme.com/contribute (official palette + ANSI). */
const dracula: CustomTheme = {
  id: 'dracula',
  name: 'Dracula',
  base: 'dark',
  tokens: {
    // App chrome sits on the darker Dracula background; terminals use the
    // canonical #282a36 so cards read as raised surfaces.
    '--color-background': '#21222c',
    '--color-surface': '#343746',
    '--color-surface-raised': '#2f313d',

    '--color-text-primary': '#f8f8f2',
    '--color-text-secondary': '#a0a8cc',
    '--color-text-tertiary': '#6272a4',

    '--color-accent': '#bd93f9',
    '--color-accent-hover': '#d6acff',
    '--color-accent-light': 'rgba(189, 147, 249, 0.2)',
    '--color-accent-ink': '#282a36',

    '--color-git': '#ffb86c',
    '--color-git-light': 'rgba(255, 184, 108, 0.15)',
    '--color-success': '#50fa7b',
    '--color-success-subtle': 'rgba(80, 250, 123, 0.15)',
    '--color-error': '#ff5555',
    '--color-status-ready': '#50fa7b',
    '--color-status-thinking': '#ff79c6',

    '--color-terminal-bg': '#282a36',
    '--color-terminal-fg': '#f8f8f2',
    '--color-terminal-surface': '#343746',
    '--color-terminal-surface-alt': '#2b2d3a',
    '--color-terminal-inset': '#21222c',

    '--color-ansi-black': '#21222c',
    '--color-ansi-red': '#ff5555',
    '--color-ansi-green': '#50fa7b',
    '--color-ansi-yellow': '#f1fa8c',
    '--color-ansi-blue': '#bd93f9',
    '--color-ansi-magenta': '#ff79c6',
    '--color-ansi-cyan': '#8be9fd',
    '--color-ansi-white': '#f8f8f2',
    '--color-ansi-bright-black': '#6272a4',
    '--color-ansi-bright-red': '#ff6e6e',
    '--color-ansi-bright-green': '#69ff94',
    '--color-ansi-bright-yellow': '#ffffa5',
    '--color-ansi-bright-blue': '#d6acff',
    '--color-ansi-bright-magenta': '#ff92df',
    '--color-ansi-bright-cyan': '#a4ffff',
    '--color-ansi-bright-white': '#ffffff',

    '--color-diff-fg': '#f8f8f2',
    '--color-diff-added': '#50fa7b',
    '--color-diff-removed': '#ff5555',
    '--color-diff-hunk': '#bd93f9',
    '--color-vcs-added': '#50fa7b',
    '--color-vcs-deleted': '#ff5555',
    '--color-vcs-renamed': '#bd93f9',
    '--color-vcs-modified': '#ffb86c',

    '--terminal-selection': 'rgba(68, 71, 90, 0.8)',
  },
};

/** Tokyo Night — https://github.com/enkia/tokyo-night-vscode-theme (night variant). */
const tokyoNight: CustomTheme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  base: 'dark',
  tokens: {
    // App chrome on the darker sidebar tone; terminals use the canonical
    // #1a1b26 editor background.
    '--color-background': '#16161e',
    '--color-surface': '#24283b',
    '--color-surface-raised': '#1f2335',

    '--color-text-primary': '#c0caf5',
    '--color-text-secondary': '#a9b1d6',
    '--color-text-tertiary': '#565f89',

    '--color-accent': '#7aa2f7',
    '--color-accent-hover': '#94b2f9',
    '--color-accent-light': 'rgba(122, 162, 247, 0.2)',
    '--color-accent-ink': '#16161e',

    '--color-git': '#ff9e64',
    '--color-git-light': 'rgba(255, 158, 100, 0.15)',
    '--color-success': '#9ece6a',
    '--color-success-subtle': 'rgba(158, 206, 106, 0.15)',
    '--color-error': '#f7768e',
    '--color-status-ready': '#9ece6a',
    '--color-status-thinking': '#bb9af7',

    '--color-terminal-bg': '#1a1b26',
    '--color-terminal-fg': '#a9b1d6',
    '--color-terminal-surface': '#24283b',
    '--color-terminal-surface-alt': '#1f2335',
    '--color-terminal-inset': '#16161e',

    '--color-ansi-black': '#414868',
    '--color-ansi-red': '#f7768e',
    '--color-ansi-green': '#9ece6a',
    '--color-ansi-yellow': '#e0af68',
    '--color-ansi-blue': '#7aa2f7',
    '--color-ansi-magenta': '#bb9af7',
    '--color-ansi-cyan': '#7dcfff',
    '--color-ansi-white': '#a9b1d6',
    '--color-ansi-bright-black': '#565f89',
    '--color-ansi-bright-red': '#f7768e',
    '--color-ansi-bright-green': '#9ece6a',
    '--color-ansi-bright-yellow': '#e0af68',
    '--color-ansi-bright-blue': '#7aa2f7',
    '--color-ansi-bright-magenta': '#bb9af7',
    '--color-ansi-bright-cyan': '#7dcfff',
    '--color-ansi-bright-white': '#c0caf5',

    '--color-diff-fg': '#c0caf5',
    '--color-diff-added': '#9ece6a',
    '--color-diff-removed': '#f7768e',
    '--color-diff-hunk': '#bb9af7',
    '--color-vcs-added': '#9ece6a',
    '--color-vcs-deleted': '#f7768e',
    '--color-vcs-renamed': '#bb9af7',
    '--color-vcs-modified': '#e0af68',

    '--terminal-selection': 'rgba(51, 70, 124, 0.8)',
  },
};

export const PRESET_THEMES: CustomTheme[] = [dracula, tokyoNight];

/**
 * User themes plus the presets they don't shadow. Resolution order matters:
 * a user theme with a preset's id wins, so edits to a preset are stored as a
 * regular custom theme and removing that copy restores the preset.
 */
export function withPresets(customThemes: CustomTheme[]): CustomTheme[] {
  return [...customThemes, ...PRESET_THEMES.filter((preset) => !customThemes.some((t) => t.id === preset.id))];
}
