import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A NUL byte anywhere in a source file makes git classify the whole file as
 * binary: no line diffs, no blame, and conflicts in it cannot be merged
 * textually. It is easy to write one by accident — a cache key separator is the
 * usual way — and nothing else notices, because the code runs fine.
 */

const SOURCE_ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.html', '.md']);
const SKIP_DIRS = new Set(['node_modules', 'assets']);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(full, found);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

describe('source files stay textual', () => {
  test('no source file contains a NUL byte', () => {
    const files = sourceFiles(SOURCE_ROOT);
    expect(files.length).toBeGreaterThan(100);

    const binary = files
      .filter((file) => fs.readFileSync(file).includes(0))
      .map((file) => path.relative(SOURCE_ROOT, file));

    // When a separator is needed, spell it \u0000 rather than writing the
    // byte into the source.
    expect(binary).toEqual([]);
  });
});
