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
    segments.push({ type: 'image', path: match[1] });
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
  let out = '';

  const appendBlockBoundary = (): void => {
    // Avoid duplicate newlines from nested blocks.
    if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  };

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const attachmentPath = el.getAttribute(ATTACHMENT_PATH_ATTR);
    if (attachmentPath) {
      out += `![](${attachmentPath})`;
      return;
    }
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    // Chrome wraps lines produced by Enter in <div>; treat them as line breaks.
    const isBlock = el.tagName === 'DIV' || el.tagName === 'P';
    if (isBlock) appendBlockBoundary();

    for (const child of Array.from(el.childNodes)) walk(child);

    if (isBlock) appendBlockBoundary();
  };

  for (const child of Array.from(root.childNodes)) walk(child);
  return out.trim();
}

/**
 * Build the DOM node for an attachment chip. Kept here (not in the React tree)
 * so the paste handler can insert a chip imperatively at the caret without
 * fighting React's reconciliation while the user is editing.
 */
export function createAttachmentChip(path: string, doc: Document = document): HTMLSpanElement {
  const fileName = path.split('/').pop() ?? path;
  const chip = doc.createElement('span');
  chip.setAttribute(ATTACHMENT_PATH_ATTR, path);
  chip.contentEditable = 'false';
  chip.className = ATTACHMENT_CHIP_CLASS;
  chip.title = path;
  // Inline pill: small icon + filename. The icon SVG is inlined so the chip
  // works without coordinating with the icon registry.
  chip.innerHTML = `
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
    <span class="chip-name"></span>
  `;
  const nameEl = chip.querySelector('.chip-name');
  if (nameEl) nameEl.textContent = fileName;
  return chip;
}
