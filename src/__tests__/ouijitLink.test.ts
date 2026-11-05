import { describe, expect, it } from 'vitest';
import { buildLink, LINK_PATTERN, parseLink, type LinkTarget } from '../links/ouijitLink';

describe('ouijit links', () => {
  it('reads as the place it goes, and reads back to it', () => {
    const cases: [LinkTarget, string][] = [
      [{ kind: 'project', project: 'horizon' }, 'ouijit://horizon'],
      [{ kind: 'board', project: 'horizon' }, 'ouijit://horizon/board'],
      [{ kind: 'task', project: 'horizon', taskNumber: 14 }, 'ouijit://horizon/tasks/14'],
      [
        { kind: 'task', project: 'horizon', taskNumber: 14, diff: { path: 'src/auth/session.ts', line: 88 } },
        'ouijit://horizon/tasks/14/diff/src/auth/session.ts:88',
      ],
      [
        { kind: 'terminal', project: 'my app', ptyId: 'pty_1', diff: { path: 'docs/read me.md' } },
        'ouijit://my%20app/terminals/pty_1/diff/docs/read%20me.md',
      ],
      [
        { kind: 'terminal', project: 'horizon', ptyId: 'pty_1', panelId: 'panel_3' },
        'ouijit://horizon/terminals/pty_1/panels/panel_3',
      ],
      [{ kind: 'pr', project: 'horizon', number: 212 }, 'ouijit://horizon/pulls/212'],
      [{ kind: 'issue', project: 'horizon', id: 'ENG-231' }, 'ouijit://horizon/issues/ENG-231'],
    ];
    for (const [target, url] of cases) {
      expect(buildLink(target)).toBe(url);
      expect(parseLink(url)).toEqual(target);
    }
  });

  it('names nothing for a link it does not understand', () => {
    for (const url of [
      'https://horizon/tasks/14',
      'ouijit://',
      'ouijit://horizon/tasks/abc',
      'ouijit://horizon/tasks/14/run',
      'ouijit://horizon/terminals/pty_1/panels',
      'ouijit://horizon/tasks/14/diff',
      'ouijit://%E0%A4%A/board',
    ]) {
      expect(parseLink(url)).toBeNull();
    }
  });

  it('is found in running text without the punctuation that ends a sentence', () => {
    const text = 'The race is at ouijit://horizon/tasks/14/diff/src/auth.ts:88. Also (ouijit://horizon/pulls/212)';
    const found = [...text.matchAll(new RegExp(LINK_PATTERN.source, 'g'))].map((m) => m[0]);
    expect(found).toEqual(['ouijit://horizon/tasks/14/diff/src/auth.ts:88', 'ouijit://horizon/pulls/212']);
  });
});
