/**
 * Opening a file at a line, against a real database and a real spawned editor.
 * Every failure here used to look identical from the outside — nothing opened,
 * nothing said — so what the caller gets back is the behaviour worth pinning.
 *
 * LAUNCH_EDITOR is launch-editor's own override, and the only way to keep the
 * test off whatever editor happens to be running on the machine.
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

function fakeEditor(): string {
  const script = path.join(tmpDir, 'fake-editor.sh');
  fs.writeFileSync(script, `#!/bin/sh\nprintf '%s ' "$@" >> '${markerFile}'\n`);
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

    const editor = fakeEditor();
    await registerEditor(editor);
    process.env.LAUNCH_EDITOR = editor;

    expect(await openFileInEditor(tmpDir, tmpDir, 'src/gone.ts', 3)).toEqual({
      success: false,
      reason: 'missing-file',
    });

    expect(await openFileInEditor(tmpDir, tmpDir, filePath, 12)).toEqual({ success: true });
    await vi.waitFor(() => expect(fs.readFileSync(markerFile, 'utf8')).toContain(`${path.join(tmpDir, filePath)} 12`));
  });

  test('names the editor it tried when that editor is not on PATH', async () => {
    await registerEditor('ouijit-not-an-editor');
    process.env.LAUNCH_EDITOR = 'ouijit-not-an-editor';

    expect(await openFileInEditor(tmpDir, tmpDir, filePath, 12)).toEqual({
      success: false,
      reason: 'launch-failed',
      editor: 'ouijit-not-an-editor',
    });
  });
});
