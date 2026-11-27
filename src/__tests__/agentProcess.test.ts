import { test, expect } from 'vitest';
import { exited, spawnAgentProcess } from '../agents';

test('an agent that dies while it is being written to is an exit, not an error the app crashes on', async () => {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  try {
    // Gone before it reads a thing, as an agent that fails to start is, while its first messages go out.
    const agent = spawnAgentProcess('/bin/sh', ['-c', 'exit 3'], process.cwd(), { PATH: process.env.PATH ?? '' });
    const writing = setInterval(() => agent.stdin.write(`${'x'.repeat(70_000)}\n`), 1);
    expect(await exited(agent)).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    clearInterval(writing);
    expect(uncaught).toEqual([]);
  } finally {
    process.off('uncaughtException', onUncaught);
  }
});
