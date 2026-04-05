import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { _resetCacheForTesting, addProject } from '../../../db';
import { handleProjectCommand } from '../../../cli/commands/project';

function captureOutput() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((data) => {
    chunks.push(typeof data === 'string' ? data : data.toString());
    return true;
  });
  return {
    spy,
    getJson: () => {
      spy.mockRestore();
      return JSON.parse(chunks.join(''));
    },
  };
}

describe('project commands', () => {
  let tempDir: string;

  beforeEach(() => {
    _resetCacheForTesting();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-proj-'));
  });

  test('list returns empty array when no projects', async () => {
    const output = captureOutput();
    await handleProjectCommand('list');
    const result = output.getJson();
    expect(result).toEqual([]);
  });

  test('list returns all projects', async () => {
    // addProject validates the directory exists, so create real dirs
    const dirA = path.join(tempDir, 'project-a');
    const dirB = path.join(tempDir, 'project-b');
    fs.mkdirSync(dirA);
    fs.mkdirSync(dirB);

    await addProject(dirA);
    await addProject(dirB);

    const output = captureOutput();
    await handleProjectCommand('list');
    const result = output.getJson();
    expect(result).toHaveLength(2);
    expect(result.map((p: { name: string }) => p.name).sort()).toEqual(['project-a', 'project-b']);
  });
});
