/**
 * Capture mode hands the panel canned data and then must keep it: the machine
 * taking screenshots has no `gh` and no Linear key, so every load would replace
 * the scene with a failure notice.
 */
let frozen = false;

export function freezeForCapture(): void {
  frozen = true;
}

export function isFrozenForCapture(): boolean {
  return frozen;
}
