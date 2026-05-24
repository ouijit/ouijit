// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import {
  parseDescription,
  serializeDescriptionDOM,
  createAttachmentChip,
  descriptionToHookPrompt,
  encodeAttachmentPath,
  decodeAttachmentPath,
} from '../utils/descriptionAttachments';

describe('parseDescription', () => {
  test('returns an empty list for empty input', () => {
    expect(parseDescription('')).toEqual([]);
  });

  test('returns a single text segment for plain text', () => {
    expect(parseDescription('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  test('extracts an image marker and the surrounding text', () => {
    expect(parseDescription('fix ![](/tmp/a.png) layout')).toEqual([
      { type: 'text', value: 'fix ' },
      { type: 'image', path: '/tmp/a.png' },
      { type: 'text', value: ' layout' },
    ]);
  });

  test('handles a leading and trailing image', () => {
    expect(parseDescription('![](/a.png) middle ![](/b.png)')).toEqual([
      { type: 'image', path: '/a.png' },
      { type: 'text', value: ' middle ' },
      { type: 'image', path: '/b.png' },
    ]);
  });

  test('preserves positional ordering across multiple images', () => {
    expect(parseDescription('![](/a.png)![](/b.png)')).toEqual([
      { type: 'image', path: '/a.png' },
      { type: 'image', path: '/b.png' },
    ]);
  });
});

describe('serializeDescriptionDOM', () => {
  function buildEditor(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  test('returns the trimmed text content for a plain editor', () => {
    expect(serializeDescriptionDOM(buildEditor('  hello  '))).toBe('hello');
  });

  test('serializes a chip back into a markdown image marker', () => {
    const editor = document.createElement('div');
    editor.appendChild(document.createTextNode('fix '));
    editor.appendChild(createAttachmentChip('/tmp/a.png'));
    editor.appendChild(document.createTextNode(' layout'));
    expect(serializeDescriptionDOM(editor)).toBe('fix ![](/tmp/a.png) layout');
  });

  test('treats <br> as a newline', () => {
    expect(serializeDescriptionDOM(buildEditor('line one<br>line two'))).toBe('line one\nline two');
  });

  test('treats <div> wrappers as line boundaries', () => {
    expect(serializeDescriptionDOM(buildEditor('<div>one</div><div>two</div>'))).toBe('one\ntwo');
  });
});

describe('descriptionToHookPrompt', () => {
  test('returns plain text unchanged', () => {
    expect(descriptionToHookPrompt('just text')).toBe('just text');
  });

  test('returns empty input untouched', () => {
    expect(descriptionToHookPrompt('')).toBe('');
  });

  test('replaces a single image marker with a quoted path', () => {
    expect(descriptionToHookPrompt('fix ![](/tmp/a.png) layout')).toBe('fix "/tmp/a.png" layout');
  });

  test('replaces every marker in order', () => {
    expect(descriptionToHookPrompt('![](/a.png) and ![](/b.png)')).toBe('"/a.png" and "/b.png"');
  });
});

describe('round-trip', () => {
  test('parse → render → serialize preserves the original markdown', () => {
    const input = 'fix ![](/tmp/a.png) the layout — ![](/tmp/b.png) here too';
    const editor = document.createElement('div');
    for (const seg of parseDescription(input)) {
      if (seg.type === 'text') editor.appendChild(document.createTextNode(seg.value));
      else editor.appendChild(createAttachmentChip(seg.path));
    }
    expect(serializeDescriptionDOM(editor)).toBe(input);
  });
});

describe('encodeAttachmentPath / decodeAttachmentPath', () => {
  test('passes a path with no reserved characters through unchanged', () => {
    expect(encodeAttachmentPath('/tmp/a.png')).toBe('/tmp/a.png');
    expect(decodeAttachmentPath('/tmp/a.png')).toBe('/tmp/a.png');
  });

  test('escapes parens that would terminate the marker early', () => {
    expect(encodeAttachmentPath('/Users/me/Document (1).pdf')).toBe('/Users/me/Document %281%29.pdf');
    expect(decodeAttachmentPath('/Users/me/Document %281%29.pdf')).toBe('/Users/me/Document (1).pdf');
  });

  test('round-trips a literal % already present in the path', () => {
    const original = '/tmp/100%25-coverage.png';
    expect(decodeAttachmentPath(encodeAttachmentPath(original))).toBe(original);
    // And a path that literally contains %28 / %29 shouldn't be mis-decoded.
    expect(decodeAttachmentPath(encodeAttachmentPath('/tmp/file %28keep%29.png'))).toBe('/tmp/file %28keep%29.png');
  });
});

describe('parser with encoded paths', () => {
  test('parseDescription decodes parens out of the storage form', () => {
    expect(parseDescription('here ![](/Users/me/Doc %281%29.pdf) ok')).toEqual([
      { type: 'text', value: 'here ' },
      { type: 'image', path: '/Users/me/Doc (1).pdf' },
      { type: 'text', value: ' ok' },
    ]);
  });

  test('serializeDescriptionDOM encodes parens back into the storage form', () => {
    const editor = document.createElement('div');
    editor.appendChild(createAttachmentChip('/Users/me/Doc (1).pdf'));
    expect(serializeDescriptionDOM(editor)).toBe('![](/Users/me/Doc %281%29.pdf)');
  });
});

describe('descriptionToHookPrompt with special characters', () => {
  test('decodes the storage form before quoting', () => {
    expect(descriptionToHookPrompt('see ![](/Users/me/Doc %281%29.pdf)')).toBe('see "/Users/me/Doc (1).pdf"');
  });

  test('escapes a literal double quote so it does not collapse the surrounding quotes', () => {
    // `data-attachment-path` happens to be `/tmp/a "real" name.png` (rare but legal).
    // After serialization that becomes `![](/tmp/a "real" name.png)`.
    expect(descriptionToHookPrompt('![](/tmp/a "real" name.png)')).toBe('"/tmp/a \\"real\\" name.png"');
  });

  test('escapes a literal backslash to keep escape sequences unambiguous', () => {
    expect(descriptionToHookPrompt('![](/tmp/a\\b.png)')).toBe('"/tmp/a\\\\b.png"');
  });
});
