import { describe, test, expect } from 'vitest';
import { buildPrBody } from '../github/service';

/**
 * A pull request is how a linked issue hears that the work landed. GitHub takes
 * a closing keyword; Linear reads the bare identifier through its own GitHub
 * integration. Both are appended, and neither twice.
 */
describe('the back-references a pull request body carries', () => {
  test('a linked issue on each side gets its own line', () => {
    expect(buildPrBody('Why this change exists', 42, 'ENG-214')).toBe('Why this change exists\n\nFixes #42\n\nENG-214');
  });

  test('a body that already says it is left alone', () => {
    expect(buildPrBody('Fixes #42 as ENG-214 asked', 42, 'ENG-214')).toBe('Fixes #42 as ENG-214 asked');
    // Case and the closing verb are both GitHub's to choose.
    expect(buildPrBody('resolves #42', 42)).toBe('resolves #42');
  });

  test('an empty body is the reference alone, rather than two blank lines and it', () => {
    expect(buildPrBody('', undefined, 'ENG-214')).toBe('ENG-214');
    expect(buildPrBody('  ', 42)).toBe('Fixes #42');
  });

  test('a task linked to neither is left exactly as written', () => {
    expect(buildPrBody('Just the body')).toBe('Just the body');
  });
});
