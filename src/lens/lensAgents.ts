import type { HealthStatus } from '../healthCheck';

/**
 * Three things a preset must be able to do, and an agent that cannot is not here:
 *
 *   isolation  The repository's own configuration must not load. A headless run
 *              in a worktree otherwise executes whatever hooks, plugins and MCP
 *              servers that repository carries, which is a diff being read
 *              turning into code being run.
 *   no tools   A headless run cannot answer an approval prompt, so a tool call
 *              is where one stalls.
 *   schema     The CLI holds the model to the shape. Recovering JSON from prose
 *              is a guess, not a contract.
 */

export type LensAgentId = 'claude' | 'codex';

export interface LensAgent {
  id: LensAgentId;
  label: string;
  /** Resolved on PATH, so the Ouijit wrapper is picked up. */
  command: string;
  args: string[];
  /**
   * `inline` writes the schema onto the command line and reads the object out of
   * a JSON envelope on stdout; `file` writes it to a temporary file and reads
   * the object out of a second file the agent is told to write.
   */
  schemaVia: 'inline' | 'file';
}

/**
 * In the order a machine with both installed picks between them. What the flags
 * buy, since dropping one silently costs the isolation:
 *
 *   claude  `-p` reads the prompt from stdin, `--safe-mode` loads none of the
 *           repository's hooks, skills, plugins, MCP servers or CLAUDE.md,
 *           `--tools ""` leaves nothing to call, and `--output-format json`
 *           carries the reply back under `structured_output`.
 *   codex   `exec -` reads the prompt from stdin, `--ignore-user-config` and
 *           `--ignore-rules` drop the config and execpolicy files, `--ephemeral`
 *           leaves no session behind, and `-s read-only` is the sandbox. `-o`
 *           writes the final message to a file — stdout is a banner and a log.
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

/** Typed off the ids, so a new preset does not compile without a probe. */
export type InstalledAgents = Pick<HealthStatus, LensAgentId>;

function pickLensAgent(installed: InstalledAgents): LensAgent | null {
  return LENS_AGENTS.find((agent) => installed[agent.id]) ?? null;
}

/**
 * Null where nothing is installed, so the failure reads "no supported agent"
 * rather than an ENOENT naming whichever binary we assumed. There is no
 * custom-command escape hatch: a binary this app knows no flags for cannot be
 * isolated or held to the schema.
 */
export function resolveLensAgent(chosenId: string | null, installed: InstalledAgents): LensAgent | null {
  return (chosenId ? lensAgent(chosenId) : null) ?? pickLensAgent(installed);
}
