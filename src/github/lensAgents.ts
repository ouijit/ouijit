/**
 * How to ask an agent one question and get one answer.
 *
 * Every agent here also has an interactive wrapper in `hookServer.ts`; this is
 * the other axis — no session, no tools, no approvals, prompt in and text out.
 * That distinction is the whole point of the redesign: a lens used to be a
 * command that had to go and find the pull request for itself, through tools
 * that need approving, in a session that often cannot approve them.
 *
 * The invocations are data rather than code because they are somebody else's
 * flags. Agent CLIs rename and reshuffle theirs far faster than this app ships,
 * and a preset that has gone stale should be a line a user edits, not a release
 * they wait for.
 */

export interface LensAgent {
  id: string;
  label: string;
  /** Binary to run. Resolved on PATH, so the Ouijit wrapper is picked up. */
  command: string;
  /** Arguments that put it in one-shot mode. */
  args: string[];
  /**
   * Whether the assembled prompt is written to stdin or appended as the last
   * argument. Stdin where an agent reads it — a diff on an argv is a diff
   * against the platform's argument-length limit — and an argument only where
   * an agent has no other way in.
   */
  promptVia: 'stdin' | 'arg';
}

/**
 * Shipped defaults, all of them editable, in the order a machine with several
 * installed picks between them.
 *
 * Each is the documented one-shot form:
 *
 *   claude    `-p` reads the prompt from stdin ("non-interactive mode reads
 *             stdin"), and `--permission-mode dontAsk` denies rather than
 *             prompts — a headless run has nobody to approve a tool call, and
 *             one that asks would sit there until the timeout. Not `--bare`,
 *             which skips the keychain and would break every subscription
 *             login. Verified against the real binary.
 *   codex     `exec -` reads the whole prompt from stdin, streams progress to
 *             stderr and prints only the final message to stdout. Its exec
 *             sandbox is read-only by default, so there is no tool to deny.
 *   pi        `-p` prints and exits, merging piped stdin into the prompt;
 *             `--no-tools` disables all of them.
 *   opencode  the one that cannot be piped to: `run` takes its message as
 *             positional arguments, and neither the flags table nor the
 *             changelog has a `--stdin`. The assembled prompt is capped well
 *             inside the platform's argv limit, so it goes on the command line.
 */
export const LENS_AGENTS: LensAgent[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    args: ['-p', '--permission-mode', 'dontAsk'],
    promptVia: 'stdin',
  },
  { id: 'codex', label: 'Codex', command: 'codex', args: ['exec', '-'], promptVia: 'stdin' },
  { id: 'pi', label: 'Pi', command: 'pi', args: ['-p', '--no-tools'], promptVia: 'stdin' },
  { id: 'opencode', label: 'opencode', command: 'opencode', args: ['run'], promptVia: 'arg' },
];

export function lensAgent(id: string): LensAgent | undefined {
  return LENS_AGENTS.find((agent) => agent.id === id);
}

/** Which agents are actually on this machine, keyed by the ids above. */
export type InstalledAgents = Partial<Record<string, boolean>>;

/** The health probe's agent flags, as both the picker and the runner want them. */
export function installedAgents(
  health: { claude: boolean; codex: boolean; pi: boolean; opencode: boolean } | null | undefined,
): InstalledAgents {
  if (!health) return {};
  return { claude: health.claude, codex: health.codex, pi: health.pi, opencode: health.opencode };
}

/**
 * The agent a project runs lenses with, as stored.
 *
 * A null `agentId` is the ordinary case: nobody has chosen, so whatever is
 * installed decides. It is deliberately not resolved and written back at first
 * run — a machine that installs a second agent, or uninstalls the first,
 * should not be answered by a preference nobody expressed.
 *
 * `command` overrides the preset entirely when set — the escape hatch for an
 * agent that is not in the list, or a preset whose flags have moved.
 */
export interface LensAgentChoice {
  agentId: string | null;
  command?: string;
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
 * Saying so here is what keeps the failure "no coding agent is installed"
 * rather than an ENOENT naming whichever binary we assumed.
 */
export function resolveLensAgent(
  choice: LensAgentChoice | null | undefined,
  installed: InstalledAgents = {},
): LensAgent | null {
  const chosen = choice?.agentId ? lensAgent(choice.agentId) : null;
  const preset = chosen ?? pickLensAgent(installed);
  const override = choice?.command?.trim();

  // An override is a whole invocation, so it stands on its own: a custom
  // command names a binary this app has never heard of, and refusing to run it
  // because nothing recognised is installed would defeat the point of it.
  if (!override) return preset;

  // Whitespace splitting rather than a shell: the prompt goes on stdin, so
  // there is nothing here that wants quoting, and no shell means no injection
  // from a field that is meant to name a binary.
  const [command, ...args] = override.split(/\s+/);
  const base = preset ?? LENS_AGENTS[0];
  return { ...base, command, args, promptVia: 'stdin' };
}
