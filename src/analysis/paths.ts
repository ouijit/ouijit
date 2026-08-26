/** Repo-relative path splitting, on the renderer side of the boundary too. */

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** With its trailing slash, so `dirname(p) + basename(p)` is `p`. */
export function dirname(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** The directory a file sits in directly; '' for a file at the repo root. */
export function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** Every directory above a path, outermost first. Empty for a root file. */
export function ancestorDirs(path: string): string[] {
  const dirs: string[] = [];
  for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
    dirs.push(path.slice(0, i));
  }
  return dirs;
}

export function depthOf(dir: string): number {
  let depth = 1;
  for (let i = dir.indexOf('/'); i !== -1; i = dir.indexOf('/', i + 1)) depth++;
  return depth;
}
