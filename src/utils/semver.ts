/**
 * Comparing plain X.Y.Z version strings.
 *
 * Not a semver library: no prerelease or build metadata. Read by the update
 * check and the `gh` version probe.
 */

export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  return !semverGt(minimum, version);
}
