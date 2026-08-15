/**
 * Comparing plain X.Y.Z version strings.
 *
 * Deliberately not a semver library and deliberately not two of these: the app's
 * own releases and the `gh` version probe were each written a comparator, and
 * one of them would have grown prerelease handling without the other.
 */

/** True when `a` is a later version than `b`. */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

/** True when `version` is at least `minimum`. */
export function versionAtLeast(version: string, minimum: string): boolean {
  return !semverGt(minimum, version);
}
