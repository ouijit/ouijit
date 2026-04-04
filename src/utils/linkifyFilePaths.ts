const TAG_RE = /<\/?[^>]+>/g;
// Matches file paths with at least one "/" and a file extension, plus optional :line or :line-line suffix.
// Negative lookbehind prevents matching inside URLs or longer dot-separated paths.
const FILE_RE = /(?<![\/\w.])(?:\.\/)?([a-zA-Z_][\w.\-]*(?:\/[\w.\-]+)+\.\w{1,10})(?::(\d+)(?:-(\d+))?)?/g;

/**
 * Wraps file-path-like text in HTML with clickable anchors.
 * Operates on raw HTML — only modifies text outside of tags and existing <a> elements.
 */
export function linkifyFilePaths(html: string): string {
  let result = '';
  let lastIndex = 0;
  let insideAnchor = false;

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(html)) !== null) {
    const textSegment = html.slice(lastIndex, match.index);
    result += insideAnchor ? textSegment : linkifyText(textSegment);

    const tag = match[0];
    if (/<a[\s>]/i.test(tag)) insideAnchor = true;
    if (/<\/a>/i.test(tag)) insideAnchor = false;
    result += tag;
    lastIndex = match.index + match[0].length;
  }

  const remaining = html.slice(lastIndex);
  result += insideAnchor ? remaining : linkifyText(remaining);
  return result;
}

function linkifyText(text: string): string {
  if (!text) return text;
  return text.replace(FILE_RE, (full, filePath: string, line?: string, endLine?: string) => {
    const attrs = [
      `data-file-ref="${filePath}"`,
      line ? `data-line="${line}"` : '',
      endLine ? `data-end-line="${endLine}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return `<a href="#" ${attrs} class="file-ref">${full}</a>`;
  });
}
