/**
 * OSC 133 ; D ; <exit_code> ST is emitted by our shell-integration precmd hook
 * after each command. Lets the renderer learn the prior command's exit code
 * without the PTY having to die. ST is either BEL (\x07) or ESC \\.
 */
export function parseOsc133ExitCodes(data: string): number[] {
  const codes: number[] = [];
  const matches = data.matchAll(/\x1b\]133;D;(-?\d+)(?:\x07|\x1b\\)/g);
  for (const match of matches) {
    const code = parseInt(match[1], 10);
    if (!Number.isNaN(code)) codes.push(code);
  }
  return codes;
}
