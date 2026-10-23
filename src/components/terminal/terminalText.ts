import type { Terminal as XTerminal } from '@xterm/xterm';

/** The buffer as it reads on screen: soft-wrapped rows joined back into their lines, trailing blanks dropped. */
export function bufferText(xterm: Pick<XTerminal, 'buffer'>, lines: number): string {
  const buffer = xterm.buffer.active;
  const out: string[] = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && out.length > 0) out[out.length - 1] += text;
    else out.push(text);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out.slice(-lines).join('\n');
}

/**
 * Escape and control characters would let pasted text end bracketed paste
 * early (`ESC[201~`) and submit what follows, so only tabs and newlines
 * survive. Without bracketed paste a newline is Enter, so multi-line text is
 * refused rather than run line by line.
 */
export function pasteable(text: string, bracketed: boolean): string | { error: string } {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  if (!bracketed && clean.includes('\n')) {
    return { error: 'That terminal is not accepting multi-line pastes; send one line' };
  }
  return clean;
}
