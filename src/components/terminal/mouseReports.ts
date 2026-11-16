/**
 * xterm measures a mouse report against its element's computed padding. Once
 * the element leaves the document — a link click swapping the card out
 * mid-press — that padding reads as '', and the button's release goes out as
 * `ESC[<0;NaN;NaNm`, which the program in the terminal takes as typed text.
 */
const UNMEASURED_MOUSE_REPORT = /\x1b\[<\d+;[^mM]*NaN[^mM]*[mM]/g;

export function dropUnmeasuredMouseReports(data: string): string {
  return data.replace(UNMEASURED_MOUSE_REPORT, '');
}
