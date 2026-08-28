import { describe, test, expect } from 'vitest';
import { resolveLensAgent, installedAgents, LENS_AGENTS } from '../lens/lensAgents';

const BOTH = { claude: true, codex: true };

/**
 * Agents preface answers with banners and apologies however firmly they are
 * asked not to, so the schema is what holds them rather than the prompt.
 */
describe('which agent writes a lens', () => {
  test('every preset is one-shot, isolated from the repo, and held to the schema', () => {
    for (const agent of LENS_AGENTS) {
      const flags = agent.args.join(' ');
      expect(['inline', 'file']).toContain(agent.schemaVia);
      // Nothing of the repository's own configuration loads: no hooks, no
      // plugins, no MCP servers, no instructions file.
      expect(flags).toMatch(/--safe-mode|--ignore-user-config/);
      expect(agent.command).toBeTruthy();
    }
  });

  test('a choice outranks the list, and no choice takes the first one installed', () => {
    expect(resolveLensAgent(null, BOTH)?.id).toBe('claude');
    expect(resolveLensAgent(null, { codex: true })?.id).toBe('codex');

    // Installing Claude Code does not silently take the lens off whoever was
    // asked for.
    expect(resolveLensAgent({ agentId: 'codex' }, BOTH)?.id).toBe('codex');
    // A choice naming something gone falls back rather than failing to run.
    expect(resolveLensAgent({ agentId: 'nonexistent' }, BOTH)?.command).toBe(LENS_AGENTS[0].command);

    // Answered here so the failure can say no supported agent is installed,
    // rather than arriving as an ENOENT for whichever binary we assumed.
    expect(resolveLensAgent(null, {})).toBeNull();
  });

  test('the health probe maps onto the agent ids', () => {
    // Pi and opencode are probed for terminals and are not lens agents: neither
    // can be held to a schema.
    expect(installedAgents({ claude: false, codex: true })).toEqual({ claude: false, codex: true });
    expect(installedAgents(null)).toEqual({});
  });
});
