import { binaryVersion, compareVersions, resolveAgentBinary } from '../../binaries';
import type { AgentClient, AgentDriver } from '../../driver';
import { ClaudeSession } from './session';

/** The Agent SDK this build ships needs a CLI at least this new for `canUseTool` and session state events. */
const CLAUDE_MIN_VERSION = '2.1.200';
/** Older ones leave a turn hanging when the permission mode changes after one of its tools ran. */
const CLAUDE_MODE_MID_TURN_VERSION = '2.1.326';

export function claudeDriver(client: AgentClient): AgentDriver {
  return {
    id: 'claude',
    label: 'Claude Code',

    oneShot(prompt) {
      const binary = resolveAgentBinary('claude', client);
      if (!binary) return null;
      const args = ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--disable-slash-commands'];
      return { command: binary, args: [...args, '--strict-mcp-config', prompt] };
    },

    async probe() {
      const binary = resolveAgentBinary('claude', client);
      if (!binary)
        return { installed: false, problem: 'Claude Code is not installed. Install it from claude.com/claude-code.' };
      const version = await binaryVersion(binary);
      if (version && compareVersions(version, CLAUDE_MIN_VERSION) < 0) {
        return {
          installed: true,
          version,
          problem: `Chat needs Claude Code ${CLAUDE_MIN_VERSION} or newer; ${version} is installed.`,
        };
      }
      return { installed: true, version };
    },

    async start(context) {
      const binary = resolveAgentBinary('claude', client);
      if (!binary) throw new Error('Claude Code is not installed');
      const session = new ClaudeSession(context, binary);
      const version = await binaryVersion(binary);
      session.modeMidTurn = !!version && compareVersions(version, CLAUDE_MODE_MID_TURN_VERSION) >= 0;
      await session.open();
      return session;
    },
  };
}
