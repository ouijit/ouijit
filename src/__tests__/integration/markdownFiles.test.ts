import { test, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listMarkdownFiles } from '../../markdownFiles';

function write(dir: string, rel: string, ageSeconds: number): void {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${rel}\n`);
  const at = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(file, at, at);
}

const names = (files: { path: string }[], dir: string) => files.map((f) => path.relative(dir, f.path));

test("a repo's markdown files are the ones git shows, tracked or not, newest first; a plain folder's skip hidden folders and dependencies", async () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-md-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  write(repo, 'README.md', 300);
  write(repo, 'docs/plan.md', 200);
  write(repo, 'src/index.ts', 10);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'dist/\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  write(repo, 'notes/today.md', 5);
  write(repo, 'dist/built.md', 1);

  expect(names(await listMarkdownFiles(repo), repo)).toEqual(['notes/today.md', 'docs/plan.md', 'README.md']);
  expect(names(await listMarkdownFiles(path.join(repo, 'docs')), path.join(repo, 'docs'))).toEqual(['plan.md']);

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-md-plain-')));
  write(plain, 'calendar.md', 100);
  write(plain, 'reports/week.md', 50);
  write(plain, 'node_modules/pkg/README.md', 1);
  write(plain, '.cache/old.md', 1);

  expect(names(await listMarkdownFiles(plain), plain)).toEqual(['reports/week.md', 'calendar.md']);
});
