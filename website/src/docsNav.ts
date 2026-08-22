export interface DocPage {
  slug: string;
  label: string;
  href: string;
  description: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'getting-started',
    label: 'Getting started',
    href: '/docs/',
    description: 'Install Ouijit, add a project, and start your first task.',
  },
  {
    slug: 'worktrees',
    label: 'Worktrees',
    href: '/docs/worktrees/',
    description: 'Per-task git worktrees: task lifecycle, merge targets, copy-on-write cloning, and creation modes.',
  },
  {
    slug: 'kanban',
    label: 'Kanban board',
    href: '/docs/kanban/',
    description: 'The four-column task board: creating tasks, drag-and-drop, and task actions.',
  },
  {
    slug: 'terminals',
    label: 'Terminals',
    href: '/docs/terminals/',
    description: 'The terminal card stack, keyboard shortcuts, the home view, and tags.',
  },
  {
    slug: 'panels',
    label: 'Panels',
    href: '/docs/panels/',
    description: 'Runner, web preview, and markdown panels attached to a terminal as tabs.',
  },
  {
    slug: 'palette',
    label: 'Command palette',
    href: '/docs/palette/',
    description: 'Jump to terminals, projects, tasks, and pull requests with one shortcut.',
  },
  {
    slug: 'diff',
    label: 'Diff review',
    href: '/docs/diff/',
    description: "Review a worktree's changes with a base picker, word-level highlighting, and notes for the agent.",
  },
  {
    slug: 'pull-requests',
    label: 'Pull requests',
    href: '/docs/pull-requests/',
    description: 'The experimental GitHub surface: a PR inbox, locally staged reviews, and merging.',
  },
  {
    slug: 'sandbox',
    label: 'Sandbox',
    href: '/docs/sandbox/',
    description: "Run a task's terminals and hooks in a Lima VM or under nono's kernel-level access limits.",
  },
  {
    slug: 'resume',
    label: 'Session resume',
    href: '/docs/resume/',
    description: 'Restore your terminals, worktrees, and panels after a restart.',
  },
  {
    slug: 'themes',
    label: 'Themes',
    href: '/docs/themes/',
    description: 'System, light, dark, five presets, and custom design-token themes.',
  },
  {
    slug: 'hooks',
    label: 'Hooks',
    href: '/docs/hooks/',
    description: 'Five lifecycle hooks and the editor command, configured per project.',
  },
  {
    slug: 'harnesses',
    label: 'Harnesses',
    href: '/docs/harnesses/',
    description: 'Live status and CLI awareness for Claude Code, Codex, Pi, and OpenCode.',
  },
  {
    slug: 'agents',
    label: 'Agents',
    href: '/docs/agents/',
    description: 'The contract for agents driving Ouijit: CLI reference, environment, and workflows.',
  },
  {
    slug: 'cli',
    label: 'CLI',
    href: '/docs/cli/',
    description: 'The ouijit command: tasks, hooks, scripts, tags, pull request drafts, themes, and panels.',
  },
];
