import { describe, test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { watchFileContents } from '../../fileWatch';

// File events arrive late on a loaded machine, as under the whole suite in parallel.
const EVENTS_TIMEOUT = 30_000;

function until(done: () => boolean, poke?: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let poked = 0;
    const check = () => {
      if (done()) return resolve();
      const waited = Date.now() - started;
      if (waited > 15_000) return reject(new Error('no file event in 15s'));
      if (poke && waited >= poked * 500) {
        poked++;
        poke();
      }
      setTimeout(check, 25);
    };
    check();
  });
}

/**
 * Watches a file and resolves once the watch is known to be live. fs.watch
 * returns before the OS is reporting events, so a save made straight after it
 * can go unheard; rewriting the file as it is until a change comes back proves
 * the watch is armed.
 */
async function armedWatch(file: string): Promise<{ saves: () => string[]; stop: () => void }> {
  const content = fs.readFileSync(file, 'utf-8');
  const heard: string[] = [];
  const stop = watchFileContents(
    file,
    (text) => heard.push(text),
    (error) => heard.push(`error ${error}`),
  );
  await until(
    () => heard.length > 0,
    () => fs.writeFileSync(file, content),
  );
  // A late event for an earlier save reads the file again and hears what it already heard.
  const saves = () => heard.filter((text, i) => text !== content && text !== heard[i - 1]);
  return { saves, stop };
}

describe('watching a markdown file', () => {
  test(
    'hears every save, in place or by an editor replacing the file, and stops when asked',
    async () => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-watch-')));
      const file = path.join(dir, 'plan.md');
      fs.writeFileSync(file, 'one');
      fs.writeFileSync(path.join(dir, 'other.md'), 'x');
      const watch = await armedWatch(file);

      fs.writeFileSync(path.join(dir, 'other.md'), 'y');
      fs.writeFileSync(file, 'two');
      await until(() => watch.saves().at(-1) === 'two');

      // An atomic save: a new file renamed over the old one, twice over.
      for (const text of ['three', 'four']) {
        const temp = path.join(dir, `.plan.md.${text}`);
        fs.writeFileSync(temp, text);
        fs.renameSync(temp, file);
        await until(() => watch.saves().at(-1) === text);
      }
      expect(watch.saves()).toEqual(['two', 'three', 'four']);

      // A second watch hearing the next save is what shows the stopped one had its chance.
      watch.stop();
      const witness = await armedWatch(file);
      fs.writeFileSync(file, 'five');
      await until(() => witness.saves().at(-1) === 'five');
      witness.stop();
      expect(watch.saves()).toEqual(['two', 'three', 'four']);
    },
    EVENTS_TIMEOUT,
  );
});
