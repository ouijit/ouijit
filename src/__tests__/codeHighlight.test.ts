import { describe, test, expect } from 'vitest';
import { languageOf, tokenizeCode } from '../utils/syntaxHighlight';

describe('highlighting a whole script', () => {
  test('its language comes from its name, else its #! line, and it comes back coloured line by line', async () => {
    expect(languageOf('scripts/release.py')).toBe('python');
    expect(languageOf('/tmp/publish', '#!/usr/bin/env bash\ngh release create v1\n')).toBe('bash');
    expect(languageOf('/tmp/sync', '#!/usr/bin/env -S deno run\nconsole.log(1)\n')).toBe('javascript');
    expect(languageOf('/tmp/notes', 'just some text\n')).toBeNull();

    const script = 'if [ -n "$TAG" ]; then\n  gh release create "$TAG"\nfi';
    const lines = await tokenizeCode(script, 'bash');
    expect(lines!.map((tokens) => tokens.map((t) => t.content).join(''))).toEqual(script.split('\n'));
    expect(new Set(lines!.flat().map((t) => t.color)).size).toBeGreaterThan(1);
  });
});
