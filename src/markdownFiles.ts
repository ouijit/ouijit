import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitAsync } from './git';

export interface MarkdownFile {
  path: string;
  modifiedAt: number;
}

const MAX_FILES = 2000;
const MAX_DEPTH = 6;
const SKIPPED_DIRS = new Set(['node_modules']);

/** Paths git would show for the folder, so what it ignores (builds, dependencies) stays out. */
async function fromGit(dir: string): Promise<string[]> {
  const out = await gitAsync(
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'],
    dir,
    16 * 1024 * 1024,
  );
  return [...new Set(out.split('\0').filter(Boolean))].map((rel) => path.join(dir, rel));
}

async function fromWalk(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (at: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    const entries = await fs.promises.readdir(at, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || found.length >= MAX_FILES) continue;
      const full = path.join(at, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full);
    }
  };
  await walk(dir, 0);
  return found;
}

/** The folder's markdown files, most recently changed first. */
export async function listMarkdownFiles(dir: string): Promise<MarkdownFile[]> {
  const paths = await fromGit(dir).catch(() => fromWalk(dir));
  const files = await Promise.all(
    paths.slice(0, MAX_FILES).map(async (p) => {
      const stat = await fs.promises.stat(p).catch(() => null);
      return stat?.isFile() ? { path: p, modifiedAt: stat.mtimeMs } : null;
    }),
  );
  return files.filter((f): f is MarkdownFile => f !== null).sort((a, b) => b.modifiedAt - a.modifiedAt);
}
