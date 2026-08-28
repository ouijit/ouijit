/**
 * The agent CLI is the one boundary a lens run cannot cross in a test, so it is
 * the one thing faked: a script on disk that answers the way each preset's real
 * binary does. Everything between the prompt and the stored groups is real, and
 * what this pins is the contract with those binaries — the schema reaches the
 * command line or a file, the prompt arrives on stdin, and the answer is read
 * back out of whichever place that preset puts it.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runLens } from '../../lens/runLens';
import { buildLensPrompt } from '../../lens/lensPrompt';
import type { LensAgent } from '../../lens/lensAgents';
import { fileDiff, diffsByPath } from '../lensFixtures';

/** What `LENS_SCHEMA` demands: every field present, and every optional one null. */
interface LensReply {
  groups: { title: string; summary: string | null; slices: { path: string; ranges: [number, number][] | null }[] }[];
}

const GROUPS: LensReply = { groups: [{ title: 'Transport', summary: null, slices: [{ path: 'a.ts', ranges: null }] }] };

let room: string;

/** Where the fake writes what it was handed, for asserting the call itself. */
const argvFile = () => path.join(room, 'argv');
const stdinFile = () => path.join(room, 'stdin');

/**
 * A binary at an absolute path rather than one on PATH: `capture` spawns
 * `agent.command` with `shell: false`, so a path is all a preset's command has
 * to be.
 */
async function fakeAgent(body: string, exit = 0): Promise<string> {
  const bin = path.join(room, 'fake-agent');
  await fs.writeFile(
    bin,
    [
      '#!/bin/sh',
      `cat > "${stdinFile()}"`,
      `printf '%s\\n' "$@" > "${argvFile()}"`,
      // Codex's shape: the answer goes to the file named by `-o`.
      'out=""',
      'while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done',
      `if [ -n "$out" ]; then printf '%s' '${body}' > "$out"; else printf '%s' '${body}'; fi`,
      `exit ${exit}`,
    ].join('\n'),
    { mode: 0o755 },
  );
  return bin;
}

function agentFor(command: string, schemaVia: LensAgent['schemaVia']): LensAgent {
  const args = schemaVia === 'inline' ? ['-p', '--output-format', 'json'] : ['exec', '-'];
  return { id: 'fake', label: 'Fake', command, args, schemaVia };
}

function run(agent: LensAgent) {
  const { prompt } = buildLensPrompt({
    subject: { lead: 'You are grouping the changes', heading: '# feature', body: 'why it changed' },
    files: [{ path: 'a.ts', status: 'M', additions: 3, deletions: 0 }],
    diffs: diffsByPath(fileDiff('a.ts', [[1, 3]])),
    instruction: 'group by story',
  });
  return runLens({ prompt, agent });
}

beforeEach(async () => {
  room = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-run-lens-'));
});

afterEach(async () => {
  await fs.rm(room, { recursive: true, force: true });
});

describe('asking an agent CLI for a grouping', () => {
  test('the envelope preset is handed the schema and the diff, and answers through structured_output', async () => {
    const envelope = JSON.stringify({ structured_output: GROUPS, total_cost_usd: 0.01 });
    const result = await run(agentFor(await fakeAgent(envelope), 'inline'));

    expect(result.success).toBe(true);
    expect(JSON.parse(result.body!).groups[0].title).toBe('Transport');

    // The schema goes on the command line, not into the prompt: a reply is
    // either the shape or a failed run.
    const argv = await fs.readFile(argvFile(), 'utf8');
    expect(argv).toContain('--json-schema');
    expect(argv).toContain('"groups"');

    // The prompt carries the whole diff, which is why the run needs no tools.
    const prompt = await fs.readFile(stdinFile(), 'utf8');
    expect(prompt).toContain('group by story');
    expect(prompt).toContain('a.ts');
    expect(prompt).toContain('line 1');
  });

  test('the answer-file preset writes its schema out and reads its reply back', async () => {
    const result = await run(agentFor(await fakeAgent(JSON.stringify(GROUPS)), 'file'));

    expect(result.success).toBe(true);
    expect(JSON.parse(result.body!).groups[0].slices[0].path).toBe('a.ts');

    const argv = await fs.readFile(argvFile(), 'utf8');
    expect(argv).toContain('--output-schema');
    expect(argv).toContain('-o');
  });

  test('a non-zero exit that still answered counts, and one that said nothing usable does not', async () => {
    // Some agents exit non-zero on a warning they have already answered through.
    const answered = await run(agentFor(await fakeAgent(JSON.stringify({ structured_output: GROUPS }), 1), 'inline'));
    expect(answered.success).toBe(true);

    const banner = await run(agentFor(await fakeAgent('Welcome to the agent!'), 'inline'));
    expect(banner.success).toBe(false);
    // The tail of the reply, so a failure says what came back instead.
    expect(banner.error).toContain('Welcome to the agent!');

    const empty = await run(agentFor(await fakeAgent(JSON.stringify({ structured_output: { groups: [] } })), 'inline'));
    expect(empty.success).toBe(false);
    expect(empty.error).toContain('no usable groups');
  });

  test('a command that is not there names itself rather than arriving as an ENOENT', async () => {
    const result = await run(agentFor(path.join(room, 'not-installed'), 'inline'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('not-installed');
    expect(result.error).toContain('not on PATH');
  });
});
