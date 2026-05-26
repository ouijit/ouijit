/**
 * OSC 133 ; D ; <exit_code> ST is emitted by our shell-integration precmd hook
 * after each command. Lets the renderer learn the prior command's exit code
 * without the PTY having to die. ST is either BEL (\x07) or ESC \\.
 *
 * Codes outside POSIX's plausible range (signals as negatives, statuses 0–255)
 * are dropped — the parser is the trust boundary between raw PTY bytes and
 * renderer state, and an OSC-injected `99999999` shouldn't be coerced into a
 * meaningful "error" verdict.
 */
export function parseOsc133ExitCodes(data: string): number[] {
  const codes: number[] = [];
  const matches = data.matchAll(/\x1b\]133;D;(-?\d+)(?:\x07|\x1b\\)/g);
  for (const match of matches) {
    const code = parseInt(match[1], 10);
    if (!Number.isFinite(code) || code < -255 || code > 255) continue;
    codes.push(code);
  }
  return codes;
}
