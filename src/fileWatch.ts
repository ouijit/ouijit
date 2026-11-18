import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Calls `onChange` with a file's new contents each time it is saved, until the
 * returned stop is called. The folder is watched rather than the file: most
 * editors save by writing a new file and renaming it over the old one, and a
 * watch on the file stays on the one that was replaced.
 */
export function watchFileContents(
  filePath: string,
  onChange: (content: string) => void,
  onError: (error: unknown) => void,
): () => void {
  const name = path.basename(filePath);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watcher = fs.watch(path.dirname(filePath), (_event, changed) => {
    if (changed !== null && changed !== name) return;
    // One save can arrive as several events.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fs.promises.readFile(filePath, 'utf-8').then(onChange, (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') onError(error);
      });
    }, 200);
  });
  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
