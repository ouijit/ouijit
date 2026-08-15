import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { statusIcon } from '../components/diff/diffStatus';
import { checkRunAppearance, stateBadge } from '../components/github/prFormat';

/**
 * Every icon name referenced in source must exist in the icon map.
 *
 * `Icon` returns null for a name it doesn't know, so a typo or an icon that was
 * never imported renders as nothing at all: no error, no warning, no fallback
 * glyph, just a button with a hole in it. Nothing else catches that — types
 * can't, because the prop is a plain string, and the renderer tests stub the
 * map with a proxy that answers to any name.
 */

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Test files are allowed to name icons that don't exist (fixtures).
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

/** The map is authored as `'kebab-name': variable,` or `bareName: variable,`. */
function iconMapKeys(): Set<string> {
  const source = readFileSync(path.join(SRC, 'utils', 'icons.ts'), 'utf8');
  const body = /export const iconMap[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? '';
  const keys = new Set<string>();
  for (const match of body.matchAll(/^\s*'?([a-zA-Z0-9-]+)'?:/gm)) keys.add(match[1]);
  return keys;
}

/**
 * Literal icon names, from the two ways this codebase writes them: the `name`
 * prop on `<Icon>`, and the `icon` field on a context menu entry. Names built
 * at runtime (the diff status helpers, the check-run appearance helpers) are
 * covered by their own tests, which assert against this same map.
 */
function referencedNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const record = (name: string, file: string) => {
    const where = found.get(name) ?? [];
    where.push(path.relative(SRC, file));
    found.set(name, where);
  };

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<Icon\s[^>]*name=["']([a-zA-Z0-9-]+)["']/g)) record(match[1], file);
    // The trailing group rejects a type position: `icon: 'project' | 'tag'` is
    // a union of allowed values in an interface, not a reference to an icon.
    for (const match of source.matchAll(/\bicon:\s*'([a-zA-Z0-9-]+)'(\s*\|)?/g)) {
      if (match[2]) continue;
      record(match[1], file);
    }
  }
  return found;
}

describe('icon names', () => {
  const map = iconMapKeys();

  test('the map parsed at all, so an empty result cannot pass this file', () => {
    expect(map.size).toBeGreaterThan(50);
    expect(map.has('terminal')).toBe(true);
  });

  test('every literal icon name in source is in the map', () => {
    const missing = [...referencedNames().entries()]
      .filter(([name]) => !map.has(name))
      .map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`);

    expect(missing).toEqual([]);
  });

  /**
   * Names chosen at runtime never appear as a literal next to `<Icon>`, so the
   * scan above cannot see them. Exercise every branch of the helpers that
   * produce one against the same map.
   */
  test('every icon name a helper can return is in the map', () => {
    const produced = new Set<string>();

    for (const status of ['M', 'A', 'D', 'R', '?', 'unexpected']) produced.add(statusIcon(status));

    for (const conclusion of [
      'SUCCESS',
      'FAILURE',
      'ERROR',
      'TIMED_OUT',
      'ACTION_REQUIRED',
      'CANCELLED',
      'SKIPPED',
      'NEUTRAL',
      'PENDING',
      'EXPECTED',
      'SOMETHING_NEW',
      null,
    ]) {
      produced.add(checkRunAppearance(conclusion, 'COMPLETED').icon);
      produced.add(checkRunAppearance(conclusion, 'IN_PROGRESS').icon);
    }

    for (const state of ['open', 'closed', 'merged'] as const) {
      produced.add(stateBadge({ state, isDraft: false }).icon);
      produced.add(stateBadge({ state, isDraft: true }).icon);
    }

    expect([...produced].filter((name) => !map.has(name))).toEqual([]);
  });
});
