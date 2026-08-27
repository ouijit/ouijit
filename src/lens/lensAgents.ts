/**
 * How to ask an agent one question and get one answer.
 *
 * Every agent here also has an interactive wrapper in `hookServer.ts`; this is
 * the other axis — no session, no tools, no approvals, prompt in and one object
 * out. A lens must need none of them: a headless run cannot answer an approval
 * prompt, so an agent that has to go and find the diff for itself stalls.
 *
 * Three things every preset has to provide, and an agent that cannot is not
 * here:
 *
 *   isolation  The repository's own configuration must not load. A headless run
 *              in a worktree otherwise executes whatever hooks, plugins and MCP
 *              servers that repository happens to carry, which is a diff being
 *              read turning into code being run.
 *   no tools   There is nothing to fetch — the prompt carries the whole diff —
 *              and a denied tool call is a run that ends in an apology.
 *   schema     The CLI holds the model to the shape, so a reply is either the
 *              object asked for or a failure. Recovering JSON from prose is a
 *              guess, not a contract.
 *
 * The invocations are data rather than code because they are somebody else's
 * flags, and agent CLIs rename and reshuffle theirs far faster than this app
 * ships. A preset that has gone stale is one line here rather than a change
 * spread across the runner.
 */

export interface LensAgent {
  id: string;
  label: string;
  /** Binary to run. Resolved on PATH, so the Ouijit wrapper is picked up. */
  command: string;
  /**
   * Arguments that put it in one-shot mode, with the repository's own
   * configuration and every tool turned off.
   */
  args: string[];
  /**
   * How the JSON schema is passed, and where the answer comes back.
   *
   * `inline` writes the schema onto the command line and reads the object out
   * of a JSON envelope on stdout; `file` writes it to a temporary file and
   * reads the object out of a second file the agent is told to write. The two
   * CLIs genuinely differ here, and hiding it behind one shape would mean
   * lying about one of them.
   */
  schemaVia: 'inline' | 'file';
}

/**
 * The presets, in the order a machine with both installed picks between them.
 *
 * Each is the documented one-shot form:
 *
 *   claude  `-p` reads the prompt from stdin. `--safe-mode` is the isolation:
 *           no repository hooks, skills, plugins, MCP servers or CLAUDE.md,
 *           while auth and the model still work normally. `--tools ""` leaves
 *           it nothing to call, and `--json-schema` holds the reply to the
 *           shape — `--output-format json` then carries it back under
 *           `structured_output`, along with what the run cost.
 *   codex   `exec -` reads the whole prompt from stdin. `--ignore-user-config`
 *           and `--ignore-rules` drop the config and execpolicy files,
 *           `--ephemeral` leaves no session behind, and `-s read-only` is the
 *           sandbox. `--output-schema` takes a file, and `-o` writes the final
 *           message to one — stdout is a banner and a progress log, so the
 *           file is the only clean way to read the answer.
 */
export const LENS_AGENTS: LensAgent[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: ['-p', '--safe-mode', '--tools', '', '--output-format', 'json'],
    schemaVia: 'inline',
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    args: [
      'exec',
      '-',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '-s',
      'read-only',
    ],
    schemaVia: 'file',
  },
];

export function lensAgent(id: string): LensAgent | undefined {
  return LENS_AGENTS.find((agent) => agent.id === id);
}

/** Which agents are actually on this machine, keyed by the ids above. */
export type InstalledAgents = Partial<Record<string, boolean>>;

/** The health probe's agent flags, as both the picker and the runner want them. */
export function installedAgents(health: { claude: boolean; codex: boolean } | null | undefined): InstalledAgents {
  if (!health) return {};
  return { claude: health.claude, codex: health.codex };
}

/**
 * The agent a project runs lenses with, as stored.
 *
 * A null `agentId` is the ordinary case: nobody has chosen, so whatever is
 * installed decides. It is deliberately not resolved and written back at first
 * run — a machine that installs a second agent, or uninstalls the first,
 * should not be answered by a preference nobody expressed.
 */
export interface LensAgentChoice {
  agentId: string | null;
}

/**
 * Whichever installed agent comes first in the list, or nothing.
 *
 * A fixed order rather than anything cleverer. Guessing from what a project's
 * hooks run, or from what was used last, is a rule nobody can predict the
 * output of — and the whole of it is one menu click away.
 */
export function pickLensAgent(installed: InstalledAgents): LensAgent | null {
  return LENS_AGENTS.find((agent) => installed[agent.id]) ?? null;
}

/**
 * The command a lens run should actually spawn.
 *
 * Null when there is nothing to spawn: no choice made and no agent installed.
 * Saying so here is what keeps the failure "no supported agent is installed"
 * rather than an ENOENT naming whichever binary we assumed.
 *
 * There is no custom-command escape hatch: a binary this app knows no flags for
 * cannot be told to isolate itself from the repository or held to the schema,
 * and those are the two things that make a run answerable.
 */
export function resolveLensAgent(
  choice: LensAgentChoice | null | undefined,
  installed: InstalledAgents = {},
): LensAgent | null {
  const chosen = choice?.agentId ? lensAgent(choice.agentId) : null;
  return chosen ?? pickLensAgent(installed);
}
