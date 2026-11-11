import { describe, expect, test } from 'vitest';
import { chatSetupCommand } from '../chat/hookSetup';

describe('a start hook in a chat card', () => {
  test('runs its setup, and leaves launching the agent to the chat', () => {
    expect(chatSetupCommand('npm install')).toBe('npm install');
    expect(chatSetupCommand('claude "$OUIJIT_TASK_DESCRIPTION"')).toBeNull();
    expect(chatSetupCommand('npm install && claude "$OUIJIT_TASK_DESCRIPTION"')).toBe('npm install');
    expect(chatSetupCommand('npm ci; npm run build && codex --full-auto "$OUIJIT_TASK_DESCRIPTION"')).toBe(
      'npm ci; npm run build',
    );
    expect(chatSetupCommand('FOO=1 exec /usr/local/bin/claude --resume')).toBeNull();
    expect(chatSetupCommand('npx opencode run "fix it"')).toBeNull();
    // A separator inside quotes is part of the argument, not the hook's structure.
    expect(chatSetupCommand('echo "a && claude" && pi')).toBe('echo "a && claude"');
    // An agent's name as an argument isn't an agent being launched.
    expect(chatSetupCommand('./scripts/setup.sh claude')).toBe('./scripts/setup.sh claude');
  });
});
