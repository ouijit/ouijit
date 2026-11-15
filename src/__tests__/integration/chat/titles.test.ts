/**
 * Each agent's one-shot, asked for a conversation's title. Re-record with
 * `RECORD_CASSETTES=1` and the agents signed in.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getDriver } from '../../../chat/drivers';
import { cleanTitle, generateTitle, titlePrompt } from '../../../chat/title';
import { cassettePath, loadCassettes, recording, recordingSpawn, replayingSpawn } from './cassette';

const AGENTS = ['claude', 'codex', 'pi', 'opencode'] as const;
const MESSAGE = 'can you look at why the release workflow keeps failing on the notarize step and fix it';
const originalPath = process.env.PATH;

beforeAll(() => {
  if (recording) return;
  // The drivers look for the agent on PATH before naming the command; replay never runs it.
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-agents-'));
  for (const agent of AGENTS) fs.writeFileSync(path.join(fakeBin, agent), '#!/bin/sh\n', { mode: 0o755 });
  process.env.PATH = `${fakeBin}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
});

describe.each(AGENTS)('a conversation titled by %s', (agent) => {
  const name = `title-${agent}`;
  test.skipIf(!recording && !fs.existsSync(cassettePath(name)))(
    'is a few words summing up what it was asked',
    async () => {
      const run = recording ? recordingSpawn(name, agent, undefined) : replayingSpawn(loadCassettes(name));
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-title-'));
      const oneShot = getDriver(agent).oneShot?.(titlePrompt(MESSAGE));
      expect(oneShot).toBeTruthy();
      const title = await generateTitle(
        async (spawn) => run(spawn.command, spawn.args, cwd, process.env as Record<string, string>),
        oneShot!,
      );
      expect(title).toMatch(/notari[sz]/i);
      expect(title!.split(' ').length).toBeLessThanOrEqual(6);
      expect(title).not.toMatch(/^["']|[."']$/);
    },
    recording ? 120_000 : 10_000,
  );
});

test('an answer is read as a title only when it is one', () => {
  expect(cleanTitle('**"Fix notarize step."**\n')).toBe('Fix notarize step');
  expect(cleanTitle('thinking…\nTitle: Release workflow fix')).toBe('Release workflow fix');
  expect(cleanTitle('\x1b[1mFix Notarize Workflow\x1b[0m')).toBe('Fix Notarize Workflow');
  expect(cleanTitle('')).toBeNull();
  expect(cleanTitle('x'.repeat(80))).toBeNull();
});
