/**
 * Opening a file at a line, against a real database and a real spawned editor.
 *
 * LAUNCH_EDITOR is launch-editor's own override, which the registered command
 * has to beat: it sits above process-list detection in launch-editor's order,
 * so a decoy there stands in for any editor already running on the machine.
 *
 * The stand-in is named `subl` because launch-editor appends a position only
 * for the editors it has a rule for, and drops the line for every other name,
 * `nvim` and `hx` included.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openFileInEditor } from '../../editorLauncher';
import { saveHook, _resetCacheForTesting } from '../../db';

let tmpDir: string;
let filePath: string;
let markerFile: string;

function fakeEditor(name: string): string {
  const script = path.join(tmpDir, name);
  fs.writeFileSync(script, `#!/bin/sh\necho "${name} $*" >> '${markerFile}'\n`);
  fs.chmodSync(script, 0o755);
  return script;
}

async function registerEditor(command: string): Promise<void> {
  await saveHook(tmpDir, { id: 'hook-editor', type: 'editor', name: 'Editor', command });
}

beforeEach(() => {
  _resetCacheForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-editor-'));
  markerFile = path.join(tmpDir, 'opened.txt');
  filePath = 'src/engine.ts';
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.writeFileSync(path.join(tmpDir, filePath), 'export const x = 1;\n');
});

afterEach(() => {
  delete process.env.LAUNCH_EDITOR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('opening a file in the editor', () => {
  test('reports the missing pieces, and hands the file and line over once they are there', async () => {
    expect(await openFileInEditor(tmpDir, tmpDir, filePath, 12)).toEqual({ success: false, reason: 'no-editor' });

    await registerEditor(fakeEditor('subl'));
    process.env.LAUNCH_EDITOR = fakeEditor('decoy');

    expect(await openFileInEditor(tmpDir, tmpDir, 'src/gone.ts', 3)).toEqual({
      success: false,
      reason: 'missing-file',
    });

    expect(await openFileInEditor(tmpDir, tmpDir, filePath, 12)).toEqual({ success: true });
    await vi.waitFor(() =>
      expect(fs.readFileSync(markerFile, 'utf8')).toContain(`subl ${path.join(tmpDir, filePath)}:12`),
    );
    expect(fs.readFileSync(markerFile, 'utf8')).not.toContain('decoy');
  });

  test('names the editor it tried when that editor is not on PATH', async () => {
    await registerEditor('ouijit-not-an-editor');

    expect(await openFileInEditor(tmpDir, tmpDir, filePath, 12)).toEqual({
      success: false,
      reason: 'launch-failed',
      editor: 'ouijit-not-an-editor',
    });
  });
});
