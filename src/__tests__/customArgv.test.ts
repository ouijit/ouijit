import { describe, test, expect } from 'vitest';
import { tokenizeCommand, resolveCommandTokens, buildCustomLaunch } from '../sandbox/custom/argv';
import type { SandboxLaunch } from '../sandbox/types';

const launch: SandboxLaunch = { file: '/bin/zsh', args: ['-il'], env: { A: '1' } };

describe('custom sandbox argv', () => {
  test('tokenizes like a shell reads words, without expanding anything', () => {
    expect(tokenizeCommand('  /opt/sb  --strict ')).toEqual(['/opt/sb', '--strict']);
    expect(tokenizeCommand(`/opt/sb --policy "my policy.json" 'it''s'`)).toEqual([
      '/opt/sb',
      '--policy',
      'my policy.json',
      'its',
    ]);
    expect(tokenizeCommand('/opt/sb a\\ b "q\\"x" \'\\n\'')).toEqual(['/opt/sb', 'a b', 'q"x', '\\n']);
    // No $VAR, ~, or glob expansion: the words run exactly as written.
    expect(tokenizeCommand('/opt/sb $HOME ~/x *.json')).toEqual(['/opt/sb', '$HOME', '~/x', '*.json']);
    expect(tokenizeCommand('')).toEqual([]);
    expect(() => tokenizeCommand('/opt/sb "open')).toThrow(/unterminated double quote/);
    expect(() => tokenizeCommand("/opt/sb 'open")).toThrow(/unterminated single quote/);
    expect(() => tokenizeCommand('/opt/sb \\')).toThrow(/dangling backslash/);
  });

  test('refuses launchers the sandboxed agent could have written', () => {
    expect(() => resolveCommandTokens('')).toThrow(/No sandbox command configured/);
    expect(() => resolveCommandTokens('   ')).toThrow(/Project Settings/);
    expect(() => resolveCommandTokens('""')).toThrow(/No sandbox command configured/);
    expect(() => resolveCommandTokens('scripts/sandbox')).toThrow(/relative path/);
    expect(() => resolveCommandTokens('./sandbox --x')).toThrow(/relative path/);
    expect(() => resolveCommandTokens('/wt/T-3/scripts/sandbox', ['/wt/T-3'])).toThrow(/inside \/wt\/T-3/);
    expect(() => resolveCommandTokens('/wt/T-3', ['/wt/T-3'])).toThrow(/inside/);
    expect(() => resolveCommandTokens('/wt/T-3/..x/sb', ['/wt/T-3'])).toThrow(/inside/);
    // Siblings and prefixes of a root are not inside it.
    expect(resolveCommandTokens('/wt/T-30/sandbox', ['/wt/T-3'])).toEqual(['/wt/T-30/sandbox']);
    expect(resolveCommandTokens('/opt/sb', ['/wt/T-3'])).toEqual(['/opt/sb']);
    expect(resolveCommandTokens('sandbox --strict', ['/wt/T-3'])).toEqual(['sandbox', '--strict']);
  });

  test('wraps the shell launch as <launcher> [args] -- <shell> [shell args] and leaves env alone', () => {
    const wrapped = buildCustomLaunch('/opt/sb --strict', launch, ['/wt/T-3']);
    expect(wrapped.file).toBe('/opt/sb');
    expect(wrapped.args).toEqual(['--strict', '--', '/bin/zsh', '-il']);
    expect(wrapped.env).toBe(launch.env);
    expect(buildCustomLaunch('sandbox', launch).args).toEqual(['--', '/bin/zsh', '-il']);
    expect(() => buildCustomLaunch('/wt/T-3/sb', launch, ['/wt/T-3'])).toThrow(/inside/);
  });
});
