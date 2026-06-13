/**
 * Terminal renderer port.
 *
 * Separates the VT core (PTY wiring, status logic, display state — owned by
 * OuijitTerminal) from the renderer implementation that actually paints the
 * grid. The port is the swap point: today the only backend is xterm.js
 * (`XtermRenderer`), but a future renderer built against another VT engine's
 * render-state API (e.g. a WebGL surface over libghostty) can drop in by
 * implementing the same interface, without touching OuijitTerminal or the app.
 *
 * The port surface is deliberately small — the five operations every backend
 * must provide. Backend-specific affordances (xterm addons, custom key
 * handlers, selection, paste) stay on the concrete class as additional public
 * members; OuijitTerminal reaches them through the typed backend handle.
 */

import { Terminal as XTerminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

/**
 * Read-only handle on the terminal's active grid buffer. xterm-compatible by
 * construction (it *is* xterm's `IBuffer`), which keeps it aligned with the
 * #460 readBuffer contract. Derived from the xterm typings because `IBuffer`
 * is not exported as a named symbol.
 */
export type RendererBuffer = XTerminal['buffer']['active'];

/**
 * The swappable renderer surface. Everything the VT core needs to drive a
 * renderer, and nothing it doesn't.
 */
export interface TerminalRenderer {
  /** Feed raw VT bytes/string into the renderer's parser. */
  write(data: string): void;
  /** Resize the rendered grid to `cols` × `rows`. */
  resize(cols: number, rows: number): void;
  /** Read the active grid buffer (xterm `IBuffer`-compatible). */
  readBuffer(): RendererBuffer;
  /** Mount the renderer into a DOM target element. */
  render(target: HTMLElement): void;
  /** Tear down the renderer and release its resources. */
  dispose(): void;
}

export interface XtermRendererOptions {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  /** Runner terminals don't blink the cursor (they're transient, non-interactive). */
  isRunner: boolean;
  /** Invoked when the user clicks a detected link in the terminal. */
  onLinkClick: (uri: string) => void;
}

/**
 * The xterm.js backend — the libghostty-spike conclusion landing point: web
 * renderer (xterm canvas) behind the port. Owns the `Terminal` instance, the
 * fit addon, and the web-links addon. Exposes `terminal` and `fitAddon` so the
 * xterm-coupled bits of OuijitTerminal (custom key handling, scroll
 * preservation, selection, paste, drag/drop, font/option mutation) keep working
 * unchanged — those are inherently web-renderer concerns and a different
 * backend would reimplement them against its own primitives.
 */
export class XtermRenderer implements TerminalRenderer {
  readonly terminal: XTerminal;
  readonly fitAddon: FitAddon;

  constructor(opts: XtermRendererOptions) {
    this.terminal = new XTerminal({
      theme: opts.theme,
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      lineHeight: 1.2,
      cursorBlink: !opts.isRunner,
      cursorStyle: 'bar',
      allowTransparency: false,
      scrollback: 2000,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon((_event, uri) => opts.onLinkClick(uri)));
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  readBuffer(): RendererBuffer {
    return this.terminal.buffer.active;
  }

  render(target: HTMLElement): void {
    this.terminal.open(target);
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
