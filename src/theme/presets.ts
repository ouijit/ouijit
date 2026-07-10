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

/** Matrix — green phosphor on near-black. Red/yellow keep distinct hues so
 * diffs and terminal error output stay readable. */
const matrix: CustomTheme = {
  id: 'matrix',
  name: 'Matrix',
  base: 'dark',
  tokens: {
    '--color-background': '#060906',
    '--color-surface': '#122012',
    '--color-surface-raised': '#0e180e',

    '--color-text-primary': '#c1ffc1',
    '--color-text-secondary': '#56c956',
    '--color-text-tertiary': '#2e7d2e',

    '--color-border': 'rgba(0, 255, 65, 0.12)',
    '--color-border-hover': 'rgba(0, 255, 65, 0.2)',

    '--color-accent': '#00ff41',
    '--color-accent-hover': '#4dff77',
    '--color-accent-light': 'rgba(0, 255, 65, 0.18)',
    '--color-accent-ink': '#031003',

    '--color-git': '#ccff33',
    '--color-git-light': 'rgba(204, 255, 51, 0.15)',
    '--color-success': '#00ff41',
    '--color-success-subtle': 'rgba(0, 255, 65, 0.15)',
    '--color-error': '#ff4d4d',
    '--color-status-ready': '#00ff41',
    '--color-status-thinking': '#66ffcc',

    '--color-terminal-bg': '#0a0f0a',
    '--color-terminal-fg': '#00ff41',
    '--color-terminal-surface': '#122012',
    '--color-terminal-surface-alt': '#0d160d',
    '--color-terminal-inset': '#060906',

    '--color-ansi-black': '#0f1f0f',
    '--color-ansi-red': '#ff4d4d',
    '--color-ansi-green': '#00ff41',
    '--color-ansi-yellow': '#ccff33',
    '--color-ansi-blue': '#33ff99',
    '--color-ansi-magenta': '#66ff66',
    '--color-ansi-cyan': '#99ffcc',
    '--color-ansi-white': '#c1ffc1',
    '--color-ansi-bright-black': '#2e7d2e',
    '--color-ansi-bright-red': '#ff8080',
    '--color-ansi-bright-green': '#4dff77',
    '--color-ansi-bright-yellow': '#e0ff80',
    '--color-ansi-bright-blue': '#80ffbf',
    '--color-ansi-bright-magenta': '#a3ffa3',
    '--color-ansi-bright-cyan': '#ccffe6',
    '--color-ansi-bright-white': '#eaffea',

    '--color-diff-fg': '#c1ffc1',
    '--color-diff-added': '#00ff41',
    '--color-diff-removed': '#ff4d4d',
    '--color-diff-hunk': '#66ffcc',
    '--color-vcs-added': '#00ff41',
    '--color-vcs-deleted': '#ff4d4d',
    '--color-vcs-renamed': '#66ffcc',
    '--color-vcs-modified': '#ccff33',

    '--terminal-selection': 'rgba(0, 255, 65, 0.22)',
  },
};

/** Hot Pink — neon pink on a dark plum base. */
const hotPink: CustomTheme = {
  id: 'hot-pink',
  name: 'Hot Pink',
  base: 'dark',
  tokens: {
    '--color-background': '#171115',
    '--color-surface': '#2c1c27',
    '--color-surface-raised': '#241620',

    '--color-text-primary': '#ffe4f1',
    '--color-text-secondary': '#d8a8c4',
    '--color-text-tertiary': '#8a5f78',

    '--color-accent': '#ff2d95',
    '--color-accent-hover': '#ff5cab',
    '--color-accent-light': 'rgba(255, 45, 149, 0.22)',
    '--color-accent-ink': '#1e0812',

    '--color-git': '#ffa657',
    '--color-git-light': 'rgba(255, 166, 87, 0.15)',
    '--color-success': '#3dd68c',
    '--color-success-subtle': 'rgba(61, 214, 140, 0.15)',
    '--color-error': '#ff4d6d',
    '--color-status-ready': '#3dd68c',
    '--color-status-thinking': '#c792ea',

    '--color-terminal-bg': '#1e141b',
    '--color-terminal-fg': '#f5dcea',
    '--color-terminal-surface': '#2c1c27',
    '--color-terminal-surface-alt': '#251721',
    '--color-terminal-inset': '#171115',

    '--color-ansi-black': '#382431',
    '--color-ansi-red': '#ff5c8a',
    '--color-ansi-green': '#3dd68c',
    '--color-ansi-yellow': '#ffd166',
    '--color-ansi-blue': '#82aaff',
    '--color-ansi-magenta': '#ff79c6',
    '--color-ansi-cyan': '#7fdbff',
    '--color-ansi-white': '#f5dcea',
    '--color-ansi-bright-black': '#8a5f78',
    '--color-ansi-bright-red': '#ff85a8',
    '--color-ansi-bright-green': '#6ee7ac',
    '--color-ansi-bright-yellow': '#ffe08a',
    '--color-ansi-bright-blue': '#a5c4ff',
    '--color-ansi-bright-magenta': '#ffa1d8',
    '--color-ansi-bright-cyan': '#a8e8ff',
    '--color-ansi-bright-white': '#fff0f8',

    '--color-diff-fg': '#ffe4f1',
    '--color-diff-added': '#3dd68c',
    '--color-diff-removed': '#ff5c8a',
    '--color-diff-hunk': '#c792ea',
    '--color-vcs-added': '#3dd68c',
    '--color-vcs-deleted': '#ff4d6d',
    '--color-vcs-renamed': '#c792ea',
    '--color-vcs-modified': '#ffa657',

    '--terminal-selection': 'rgba(255, 45, 149, 0.25)',
  },
};

/** Sepia — warm paper tones on the light base. */
const sepia: CustomTheme = {
  id: 'sepia',
  name: 'Sepia',
  base: 'light',
  tokens: {
    '--color-background': '#f0e7d8',
    '--color-surface': '#faf4e8',
    '--color-surface-raised': '#e6dcc8',

    '--color-text-primary': '#3d2f1f',
    '--color-text-secondary': '#7a6a52',
    '--color-text-tertiary': '#a89a80',
    '--color-ink': '#2e2416',

    '--color-border': 'rgba(74, 58, 36, 0.14)',
    '--color-border-hover': 'rgba(74, 58, 36, 0.22)',
    '--color-bezel-panel': 'rgba(74, 58, 36, 0.3)',

    '--color-accent': '#a4632a',
    '--color-accent-hover': '#8a5222',
    '--color-accent-light': 'rgba(164, 99, 42, 0.15)',
    '--color-accent-ink': '#ffffff',

    '--color-git': '#b3541e',
    '--color-git-light': 'rgba(179, 84, 30, 0.12)',
    '--color-success': '#5a7a29',
    '--color-success-subtle': 'rgba(90, 122, 41, 0.15)',
    '--color-error': '#b3392f',
    '--color-status-ready': '#5a7a29',
    '--color-status-thinking': '#94518d',

    '--color-terminal-bg': '#f7efe0',
    '--color-terminal-fg': '#433422',
    '--color-terminal-surface': '#e9dfc9',
    '--color-terminal-surface-alt': '#f0e7d5',
    '--color-terminal-inset': '#efe5d2',

    '--color-ansi-black': '#433422',
    '--color-ansi-red': '#b3392f',
    '--color-ansi-green': '#5a7a29',
    '--color-ansi-yellow': '#b07d10',
    '--color-ansi-blue': '#4a6a8f',
    '--color-ansi-magenta': '#94518d',
    '--color-ansi-cyan': '#3d7a70',
    '--color-ansi-white': '#e6dcc8',
    '--color-ansi-bright-black': '#7a6a52',
    '--color-ansi-bright-red': '#d24a3e',
    '--color-ansi-bright-green': '#6f9433',
    '--color-ansi-bright-yellow': '#cf9415',
    '--color-ansi-bright-blue': '#5d81ab',
    '--color-ansi-bright-magenta': '#b06aa8',
    '--color-ansi-bright-cyan': '#4d9488',
    '--color-ansi-bright-white': '#faf4e8',

    '--color-diff-fg': '#3d2f1f',
    '--color-diff-added': '#5a7a29',
    '--color-diff-removed': '#b3392f',
    '--color-diff-hunk': '#94518d',
    '--color-vcs-added': '#5a7a29',
    '--color-vcs-deleted': '#b3392f',
    '--color-vcs-renamed': '#94518d',
    '--color-vcs-modified': '#b07d10',

    '--terminal-selection': 'rgba(164, 99, 42, 0.2)',
  },
};

export const PRESET_THEMES: CustomTheme[] = [dracula, tokyoNight, matrix, hotPink, sepia];

/**
 * User themes plus the presets they don't shadow. Resolution order matters:
 * a user theme with a preset's id wins, so edits to a preset are stored as a
 * regular custom theme and removing that copy restores the preset.
 */
export function withPresets(customThemes: CustomTheme[]): CustomTheme[] {
  return [...customThemes, ...PRESET_THEMES.filter((preset) => !customThemes.some((t) => t.id === preset.id))];
}
