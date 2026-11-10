import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readMarkdownImage } from '../../markdownImages';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;

let tmpDir: string;
let markdownPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouijit-markdown-images-'));
  const png = Buffer.from(PNG_BASE64, 'base64');
  await fs.mkdir(path.join(tmpDir, 'docs', 'shots'), { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'logo.png'), png);
  await fs.writeFile(path.join(tmpDir, 'docs', 'shots', 'my shot.PNG'), png);
  await fs.writeFile(path.join(tmpDir, 'docs', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(tmpDir, 'docs', 'secret.txt'), 'not an image');
  markdownPath = path.join(tmpDir, 'docs', 'plan.md');
  await fs.writeFile(markdownPath, '# Plan\n');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('images referenced from a markdown file', () => {
  test('resolve against the file and come back as data URLs', async () => {
    expect(await readMarkdownImage(markdownPath, '../logo.png')).toBe(PNG_URL);
    expect(await readMarkdownImage(markdownPath, path.join(tmpDir, 'logo.png'))).toBe(PNG_URL);
    expect(await readMarkdownImage(markdownPath, './shots/my%20shot.PNG?raw=true#top')).toBe(PNG_URL);
    expect(await readMarkdownImage(markdownPath, 'icon.svg')).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  test('anything that is not a readable image within the size cap is refused', async () => {
    expect(await readMarkdownImage(markdownPath, 'secret.txt')).toBeNull();
    expect(await readMarkdownImage(markdownPath, 'missing.png')).toBeNull();
    expect(await readMarkdownImage(markdownPath, '../logo.png', 10)).toBeNull();
  });
});
