/**
 * Parse and serialize the task description format.
 *
 * Image attachments live inline in the description as markdown image refs:
 *
 *     fix this layout ![](/Users/.../img-abc.png) the button overflows
 *
 * The position of the marker is the position the user pasted the image, and
 * CLI agents read the image from the absolute path that's already in the
 * prompt text — no parallel attachment list, no `--image` flag plumbing.
 */

export type DescriptionSegment = { type: 'text'; value: string } | { type: 'image'; path: string };

/** Markdown image syntax with an empty alt text. Path runs until the next `)`. */
const IMAGE_REF_REGEX = /!\[\]\(([^)]+)\)/g;

/** Marker class for chip elements rendered in the contentEditable. */
export const ATTACHMENT_CHIP_CLASS = 'description-attachment-chip';

/** Data attribute holding the absolute path on a chip element. */
export const ATTACHMENT_PATH_ATTR = 'data-attachment-path';

/**
 * Round-trip-safe escape for paths stored inside `![](...)` markers. The
 * marker terminates at the first `)`, so any literal `(` or `)` in the path
 * has to be escaped; `%` is escaped first/decoded last to make a path that
 * already contains `%28` / `%29` round-trip cleanly. Other characters
 * (including spaces and quotes) are left alone — they don't break the marker.
 */
export function encodeAttachmentPath(path: string): string {
  return path.replace(/%/g, '%25').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function decodeAttachmentPath(encoded: string): string {
  return encoded.replace(/%29/g, ')').replace(/%28/g, '(').replace(/%25/g, '%');
}

/** Escape `"` and `\` so a path can be safely embedded inside `"..."`. */
function escapeForDoubleQuotes(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Split a description string into a flat list of text and image segments,
 * preserving the order in which they appeared.
 */
export function parseDescription(text: string): DescriptionSegment[] {
  if (!text) return [];
  const segments: DescriptionSegment[] = [];
  let cursor = 0;
  // Each match consumes one `![](path)` token; the text between matches
  // becomes a text segment.
  for (const match of text.matchAll(IMAGE_REF_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, start) });
    }
    segments.push({ type: 'image', path: decodeAttachmentPath(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) });
  }
  return segments;
}

/**
 * Walk a contentEditable subtree and reconstruct the markdown-flavoured
 * description string. Chip elements (marked with `data-attachment-path`)
 * become `![](path)` markers in the output; everything else flattens to its
 * text content, with `<br>` and block boundaries becoming newlines.
 */
export function serializeDescriptionDOM(root: Node): string {
  return walkDescriptionDOM(root).text.trim();
}

/** A DOM Range start position, used to stop the walk at the caret. */
interface CaretStop {
  node: Node;
  offset: number;
}

/**
 * The shared walk behind serialization and caret measurement. Without a stop
 * it produces the full (untrimmed) storage string; with one it stops at that
 * position, so `text.length` is the caret's offset into the same string.
 */
function walkDescriptionDOM(root: Node, stop?: CaretStop): { text: string; stopped: boolean } {
  let out = '';
  let stopped = false;

  const appendBlockBoundary = (): void => {
    // Avoid duplicate newlines from nested blocks.
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  };

  /** Walk an element's children, honouring a stop that points between them. */
  const walkChildren = (parent: Node): void => {
    const children = Array.from(parent.childNodes);
    for (let i = 0; i < children.length; i++) {
      if (stop && stop.node === parent && stop.offset === i) {
        stopped = true;
        return;
      }
      walk(children[i]);
      if (stopped) return;
    }
    if (stop && stop.node === parent && stop.offset >= children.length) stopped = true;
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (stop && stop.node === node) {
        out += text.slice(0, stop.offset);
        stopped = true;
      } else {
        out += text;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const attachmentPath = el.getAttribute(ATTACHMENT_PATH_ATTR);
    if (attachmentPath) {
      out += `![](${encodeAttachmentPath(attachmentPath)})`;
      return;
    }
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    // Chrome wraps lines produced by Enter in <div>; treat them as line breaks.
    const isBlock = el.tagName === 'DIV' || el.tagName === 'P';
    if (isBlock) appendBlockBoundary();

    walkChildren(el);
    if (stopped) return;

    if (isBlock) appendBlockBoundary();
  };

  walkChildren(root);
  return { text: out, stopped };
}

/** Serialized length of one chip, i.e. the `![](path)` marker it stands for. */
function chipMarkerLength(chip: HTMLElement): number {
  return `![](${encodeAttachmentPath(chip.getAttribute(ATTACHMENT_PATH_ATTR) ?? '')})`.length;
}

/**
 * Where the caret sits, as an offset into the storage string rather than the
 * DOM, so it carries between the inline composer and the expanded sheet. A chip
 * counts as the full length of its `![](path)` marker.
 *
 * Returns null when the selection isn't inside `root`.
 */
export function getCaretOffset(root: HTMLElement): number | null {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  const prefix = walkDescriptionDOM(root, { node: range.startContainer, offset: range.startOffset });
  if (!prefix.stopped) return null;

  // serializeDescriptionDOM trims, so drop the leading whitespace the caret
  // offset would otherwise be measured past.
  const full = walkDescriptionDOM(root).text;
  const trimmedFromStart = full.length - full.trimStart().length;
  return Math.max(0, prefix.text.length - trimmedFromStart);
}

/**
 * Place the caret `offset` characters into the storage string. Intended for
 * an editor that was just repopulated from that value, where the children are
 * the flat list of text nodes and chips that `parseDescription` produces.
 */
export function setCaretOffset(root: HTMLElement, offset: number): void {
  const doc = root.ownerDocument;
  const selection = doc.defaultView?.getSelection();
  if (!selection) return;

  const range = doc.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;

  for (const node of Array.from(root.childNodes)) {
    const length = isAttachmentChip(node) ? chipMarkerLength(node) : (node.textContent ?? '').length;
    if (remaining <= length) {
      if (node.nodeType === Node.TEXT_NODE) range.setStart(node, remaining);
      else if (remaining === 0) range.setStartBefore(node);
      else range.setStartAfter(node);
      placed = true;
      break;
    }
    remaining -= length;
  }

  if (placed) {
    range.collapse(true);
  } else {
    // Past the end (or an empty editor): park at the end of the content.
    range.selectNodeContents(root);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Build the DOM node for an attachment chip. The visible label (`[Img #N]`)
 * is generated by a CSS counter so chips auto-renumber when one is deleted or
 * reordered — no React state, no per-chip rerender.
 */
export function createAttachmentChip(path: string, doc: Document = document): HTMLSpanElement {
  const chip = doc.createElement('span');
  chip.setAttribute(ATTACHMENT_PATH_ATTR, path);
  chip.contentEditable = 'false';
  chip.className = ATTACHMENT_CHIP_CLASS;
  chip.title = path;
  return chip;
}

export function isAttachmentChip(node: Node | null | undefined): node is HTMLElement {
  return (
    !!node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains(ATTACHMENT_CHIP_CLASS)
  );
}

/**
 * Convert the stored description to the form a CLI agent sees. The `![](path)`
 * marker is an internal sentinel for our chip renderer — agents like Claude
 * Code or Codex parse file paths from the prompt directly, so we strip the
 * markdown noise and leave a quoted absolute path in its place. Paths are
 * decoded from the storage format and escaped so a `"` or `\` in the path
 * doesn't collapse the surrounding quotes.
 */
export function descriptionToHookPrompt(text: string): string {
  if (!text) return text;
  return text.replace(/!\[\]\(([^)]+)\)/g, (_, encoded) => {
    return `"${escapeForDoubleQuotes(decodeAttachmentPath(encoded))}"`;
  });
}
