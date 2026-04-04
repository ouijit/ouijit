import { describe, it, expect } from 'vitest';
import { linkifyFilePaths } from '../utils/linkifyFilePaths';

describe('linkifyFilePaths', () => {
  // ── Detection ───────────────────────────────────────────────────────

  it('wraps a simple file path with data-file-ref', () => {
    const html = '<p>Edit src/foo.ts to fix the bug</p>';
    const result = linkifyFilePaths(html);
    expect(result).toContain('data-file-ref="src/foo.ts"');
    expect(result).toContain('class="file-ref"');
  });

  it('detects path with line number', () => {
    const result = linkifyFilePaths('<p>See src/foo.ts:42</p>');
    expect(result).toContain('data-file-ref="src/foo.ts"');
    expect(result).toContain('data-line="42"');
  });

  it('detects path with line range', () => {
    const result = linkifyFilePaths('<p>See src/foo.ts:42-60</p>');
    expect(result).toContain('data-file-ref="src/foo.ts"');
    expect(result).toContain('data-line="42"');
    expect(result).toContain('data-end-line="60"');
  });

  it('detects path with leading ./', () => {
    const result = linkifyFilePaths('<p>See ./src/foo.ts</p>');
    expect(result).toContain('data-file-ref="src/foo.ts"');
    // Display text preserves the ./
    expect(result).toContain('./src/foo.ts</a>');
  });

  it('detects deeply nested paths', () => {
    const result = linkifyFilePaths('<p>path/to/deep/nested/file.tsx:10</p>');
    expect(result).toContain('data-file-ref="path/to/deep/nested/file.tsx"');
    expect(result).toContain('data-line="10"');
  });

  it('detects multiple file paths in the same text', () => {
    const result = linkifyFilePaths('<p>Edit src/a.ts and src/b.ts</p>');
    expect(result).toContain('data-file-ref="src/a.ts"');
    expect(result).toContain('data-file-ref="src/b.ts"');
  });

  it('detects file path at start of text', () => {
    const result = linkifyFilePaths('src/foo.ts is the entry point');
    expect(result).toContain('data-file-ref="src/foo.ts"');
  });

  it('detects file path at end of text', () => {
    const result = linkifyFilePaths('The entry point is src/foo.ts');
    expect(result).toContain('data-file-ref="src/foo.ts"');
  });

  // ── Non-detection ──��───────────────────────────────────────────────

  it('does not match bare filenames without /', () => {
    const html = '<p>Edit foo.ts</p>';
    const result = linkifyFilePaths(html);
    expect(result).not.toContain('data-file-ref');
  });

  it('does not match HTTP URLs', () => {
    const html = '<p>See http://example.com/foo.ts</p>';
    const result = linkifyFilePaths(html);
    expect(result).not.toContain('data-file-ref');
  });

  it('does not match HTTPS URLs', () => {
    const html = '<p>See https://github.com/user/repo.git</p>';
    const result = linkifyFilePaths(html);
    expect(result).not.toContain('data-file-ref');
  });

  it('does not wrap text already inside an <a> tag', () => {
    const html = '<p><a href="https://example.com">src/foo.ts</a></p>';
    const result = linkifyFilePaths(html);
    // Should not create a nested anchor
    expect(result).not.toContain('data-file-ref');
    expect(result).toBe(html);
  });

  // ── HTML safety ────────────────────────────────────────────────────

  it('does not corrupt existing HTML tags', () => {
    const html = '<div class="test"><strong>src/foo.ts</strong></div>';
    const result = linkifyFilePaths(html);
    expect(result).toContain('<div class="test">');
    expect(result).toContain('<strong>');
    expect(result).toContain('</strong>');
    expect(result).toContain('</div>');
    expect(result).toContain('data-file-ref="src/foo.ts"');
  });

  it('does not modify text inside tag attributes', () => {
    const html = '<a href="src/foo.ts">click here</a>';
    const result = linkifyFilePaths(html);
    // The href attribute should be untouched, and since we're inside an anchor, text is not wrapped
    expect(result).toBe(html);
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(linkifyFilePaths('')).toBe('');
  });

  it('returns unchanged HTML when no file paths present', () => {
    const html = '<p>No file paths here</p>';
    expect(linkifyFilePaths(html)).toBe(html);
  });

  it('handles inline code spans containing file paths', () => {
    // marked renders `src/foo.ts` as <code>src/foo.ts</code>
    const html = '<p>See <code>src/foo.ts:42</code></p>';
    const result = linkifyFilePaths(html);
    expect(result).toContain('data-file-ref="src/foo.ts"');
    expect(result).toContain('data-line="42"');
  });

  it('handles plain text with no HTML tags', () => {
    const result = linkifyFilePaths('Edit src/foo.ts to fix it');
    expect(result).toContain('data-file-ref="src/foo.ts"');
  });

  it('handles various file extensions', () => {
    for (const ext of ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'rb', 'css', 'html']) {
      const result = linkifyFilePaths(`<p>src/file.${ext}</p>`);
      expect(result).toContain(`data-file-ref="src/file.${ext}"`);
    }
  });
});
