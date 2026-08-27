/**
 * How to ask an agent one question and get one answer: no session, no tools, no
 * approvals, prompt in and one object out. Three things every preset must
 * provide, and an agent that cannot is not here:
 *
 *   isolation  The repository's own configuration must not load. A headless run
 *              in a worktree otherwise executes whatever hooks, plugins and MCP
 *              servers that repository carries, which is a diff being read
 *              turning into code being run.
 *   no tools   The prompt carries the whole diff, and a headless run cannot
 *              answer an approval prompt, so a tool call is where one stalls.
 *   schema     The CLI holds the model to the shape. Recovering JSON from prose
 *              is a guess, not a contract.
 *
 * Data rather than code because they are somebody else's flags, and agent CLIs
 * rename and reshuffle theirs faster than this app ships.
 */

export interface LensAgent {
  id: string;
  label: string;
  /** Binary to run. Resolved on PATH, so the Ouijit wrapper is picked up. */
  command: string;
  /** Arguments that put it in one-shot mode, isolated and with no tools. */
  args: string[];
  /**
   * `inline` writes the schema onto the command line and reads the object out of
   * a JSON envelope on stdout; `file` writes it to a temporary file and reads
   * the object out of a second file the agent is told to write.
   */
  schemaVia: 'inline' | 'file';
}

/**
 * The presets, in the order a machine with both installed picks between them.
 *
 *   claude  `-p` reads the prompt from stdin. `--safe-mode` is the isolation:
 *           no repository hooks, skills, plugins, MCP servers or CLAUDE.md,
 *           while auth and the model still work normally. `--tools ""` leaves
 *           nothing to call, `--json-schema` holds the reply to the shape, and
 *           `--output-format json` carries it back under `structured_output`.
 *   codex   `exec -` reads the prompt from stdin. `--ignore-user-config` and
 *           `--ignore-rules` drop the config and execpolicy files, `--ephemeral`
 *           leaves no session behind, `-s read-only` is the sandbox.
 *           `--output-schema` takes a file, and `-o` writes the final message to
 *           one — stdout is a banner and a progress log.
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

function lensAgent(id: string): LensAgent | undefined {
  return LENS_AGENTS.find((agent) => agent.id === id);
}

/** Which agents are actually on this machine, keyed by the ids above. */
export type InstalledAgents = Partial<Record<string, boolean>>;

export function installedAgents(health: { claude: boolean; codex: boolean } | null | undefined): InstalledAgents {
  if (!health) return {};
  return { claude: health.claude, codex: health.codex };
}

/**
 * A null `agentId` is the ordinary case: nobody has chosen, so whatever is
 * installed decides. Never resolved and written back, or a machine that later
 * installs a second agent would be answered by a preference nobody expressed.
 */
export interface LensAgentChoice {
  agentId: string | null;
}

export function pickLensAgent(installed: InstalledAgents): LensAgent | null {
  return LENS_AGENTS.find((agent) => installed[agent.id]) ?? null;
}

/**
 * Null when no choice was made and nothing is installed, which is what keeps the
 * failure "no supported agent is installed" rather than an ENOENT naming
 * whichever binary we assumed. There is no custom-command escape hatch: a binary
 * this app knows no flags for cannot be isolated or held to the schema.
 */
export function resolveLensAgent(
  choice: LensAgentChoice | null | undefined,
  installed: InstalledAgents = {},
): LensAgent | null {
  const chosen = choice?.agentId ? lensAgent(choice.agentId) : null;
  return chosen ?? pickLensAgent(installed);
}
