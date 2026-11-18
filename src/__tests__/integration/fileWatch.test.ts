import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { watchFileContents } from '../../fileWatch';

function nextChange(changes: string[], count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (changes.length >= count) return resolve();
      if (Date.now() - started > 5000) return reject(new Error(`saw ${changes.length} changes, wanted ${count}`));
      setTimeout(check, 25);
    };
    check();
  });
}

describe('watching a markdown file', () => {
  test('hears every save, in place or by an editor replacing the file, and stops when asked', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-watch-')));
    const file = path.join(dir, 'plan.md');
    fs.writeFileSync(file, 'one');
    fs.writeFileSync(path.join(dir, 'other.md'), 'x');
    const changes: string[] = [];
    const stop = watchFileContents(
      file,
      (content) => changes.push(content),
      (error) => changes.push(`error ${error}`),
    );

    fs.writeFileSync(path.join(dir, 'other.md'), 'y');
    fs.writeFileSync(file, 'two');
    await nextChange(changes, 1);

    // An atomic save: a new file renamed over the old one, twice over.
    for (const text of ['three', 'four']) {
      const temp = path.join(dir, `.plan.md.${text}`);
      fs.writeFileSync(temp, text);
      fs.renameSync(temp, file);
      await nextChange(changes, changes.length + 1);
    }
    expect(changes).toEqual(['two', 'three', 'four']);

    stop();
    fs.writeFileSync(file, 'five');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(changes).toEqual(['two', 'three', 'four']);
  });
});
