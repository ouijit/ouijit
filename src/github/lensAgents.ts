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
   * argument. Stdin is preferred and is what every default uses: a diff on an
   * argv is a diff against the platform's argument-length limit.
   */
  promptVia: 'stdin' | 'arg';
}

/**
 * Shipped defaults, all of them editable.
 *
 * Only the Claude invocation has been run against the real binary during
 * development; the rest are the documented one-shot forms. They are presets, so
 * being wrong about one costs an edit rather than a broken feature.
 */
export const LENS_AGENTS: LensAgent[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', args: ['-p'], promptVia: 'stdin' },
  { id: 'codex', label: 'Codex', command: 'codex', args: ['exec', '-'], promptVia: 'stdin' },
  { id: 'pi', label: 'Pi', command: 'pi', args: ['-p'], promptVia: 'stdin' },
  { id: 'opencode', label: 'opencode', command: 'opencode', args: ['run'], promptVia: 'stdin' },
];

export const DEFAULT_LENS_AGENT = 'claude';

export function lensAgent(id: string): LensAgent | undefined {
  return LENS_AGENTS.find((agent) => agent.id === id);
}

/**
 * The agent a project runs lenses with, as stored.
 *
 * `command` overrides the preset entirely when set — the escape hatch for an
 * agent that is not in the list, or a preset whose flags have moved.
 */
export interface LensAgentChoice {
  agentId: string;
  command?: string;
}

/** Split a stored override into a command and its arguments. */
export function resolveLensAgent(choice: LensAgentChoice | null | undefined): LensAgent {
  const preset = lensAgent(choice?.agentId ?? DEFAULT_LENS_AGENT) ?? LENS_AGENTS[0];
  const override = choice?.command?.trim();
  if (!override) return preset;

  // Whitespace splitting rather than a shell: the prompt goes on stdin, so
  // there is nothing here that wants quoting, and no shell means no injection
  // from a field that is meant to name a binary.
  const [command, ...args] = override.split(/\s+/);
  return { ...preset, command, args, promptVia: 'stdin' };
}
