import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { stateGlyph } from '../components/linear/stateGlyph';
import type { LinearStateType } from '../linear/types';

const TYPES: LinearStateType[] = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled', 'duplicate'];

/**
 * The seven state types are Linear's, and a team's state names are its own — so
 * the glyph keys on the type. A list drawn as one circle in seven colours is
 * one nobody can scan, which is the whole point of the mapping.
 */
describe('the glyph a workflow state is drawn as', () => {
  test('every type gets its own, and an unknown one still draws something', () => {
    const glyphs = TYPES.map(stateGlyph);
    expect(new Set(glyphs).size).toBe(TYPES.length);
    expect(stateGlyph('something-linear-added-later' as LinearStateType)).toBe('circle');
  });

  /**
   * `Icon` renders nothing for a name the map does not know: no error, no
   * fallback glyph, just a row with a hole in it. The names here are built at
   * runtime, so the source scan in `iconNames` cannot see them.
   */
  test('every glyph it can return is in the icon map', () => {
    const source = readFileSync(path.resolve(__dirname, '..', 'utils', 'icons.ts'), 'utf8');
    const body = /export const iconMap[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
    const names = new Set([...body.matchAll(/^\s*'?([a-zA-Z0-9-]+)'?:/gm)].map((m) => m[1]));

    for (const glyph of [...TYPES.map(stateGlyph), stateGlyph('' as LinearStateType)]) {
      expect(names.has(glyph), `${glyph} is missing from the icon map`).toBe(true);
    }
  });
});
