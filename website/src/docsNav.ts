export interface DocPage {
  slug: string;
  label: string;
  href: string;
  description: string;
  group: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'getting-started',
    label: 'Getting started',
    href: '/docs/',
    description: 'Install Ouijit and add your first project.',
    group: 'Get started',
  },
  {
    slug: 'cli',
    label: 'CLI',
    href: '/docs/cli/',
    description: 'The ouijit command: tasks, hooks, scripts, tags, pull request drafts, themes, and panels.',
    group: 'Agents',
  },
  {
    slug: 'harnesses',
    label: 'Supported agents',
    href: '/docs/harnesses/',
    description: 'Live status and CLI awareness for Claude Code, Codex, Pi, and OpenCode.',
    group: 'Agents',
  },
  {
    slug: 'agents',
    label: 'For agents',
    href: '/docs/agents/',
    description: 'The contract for agents driving Ouijit: CLI reference, environment, and workflows.',
    group: 'Agents',
  },
  {
    slug: 'worktrees',
    label: 'Tasks and worktrees',
    href: '/docs/worktrees/',
    description: 'The task board, the task lifecycle, per-task git worktrees, merge targets, and creation modes.',
    group: 'Concepts',
  },
  {
    slug: 'hooks',
    label: 'Hooks',
    href: '/docs/hooks/',
    description: 'Commands that run when a task starts, continues, goes to review, or is done.',
    group: 'Concepts',
  },
  {
    slug: 'sandbox',
    label: 'Sandbox',
    href: '/docs/sandbox/',
    description: "Run a task's terminals and hooks under nono's kernel-level access limits, or your own launcher.",
    group: 'Concepts',
  },
  {
    slug: 'terminals',
    label: 'Terminals',
    href: '/docs/terminals/',
    description: 'The sidebar, the terminal card stack, keyboard shortcuts, tags, and resuming a session.',
    group: 'Using the app',
  },
  {
    slug: 'panels',
    label: 'Panels',
    href: '/docs/panels/',
    description: 'Runner, web preview, and markdown panels attached to a terminal as tabs.',
    group: 'Using the app',
  },
  {
    slug: 'palette',
    label: 'Command palette',
    href: '/docs/palette/',
    description: 'Jump to terminals, projects, tasks, and pull requests with one shortcut.',
    group: 'Using the app',
  },
  {
    slug: 'diff',
    label: 'Diff review',
    href: '/docs/diff/',
    description: "Review a worktree's changes with a base picker, word-level highlighting, and notes for the agent.",
    group: 'Using the app',
  },
  {
    slug: 'pull-requests',
    label: 'Pull requests and issues',
    href: '/docs/pull-requests/',
    description:
      'The experimental tracker surface: a PR inbox, locally staged reviews, merging, and issues from GitHub and Linear.',
    group: 'Using the app',
  },
  {
    slug: 'themes',
    label: 'Themes',
    href: '/docs/themes/',
    description: 'System, light, dark, five presets, and custom design-token themes.',
    group: 'Using the app',
  },
];

export const DOC_GROUPS = [...new Set(DOC_PAGES.map((p) => p.group))].map((name) => ({
  name,
  pages: DOC_PAGES.filter((p) => p.group === name),
}));
