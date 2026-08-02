// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import {
  parseDescription,
  serializeDescriptionDOM,
  createAttachmentChip,
  descriptionToHookPrompt,
  encodeAttachmentPath,
  decodeAttachmentPath,
  getCaretOffset,
  setCaretOffset,
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

/**
 * The caret travels between the inline composer and its expanded sheet as an
 * offset into the storage string, so both editors agree on where it sits even
 * though their DOM differs. Chips count as their whole `![](path)` marker,
 * matching how the value is stored.
 */
describe('caret offsets', () => {
  /** Build an editor the way parseDescription would populate one. */
  function editorFor(value: string): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    for (const segment of parseDescription(value)) {
      if (segment.type === 'text') el.appendChild(document.createTextNode(segment.value));
      else el.appendChild(createAttachmentChip(segment.path));
    }
    return el;
  }

  test('round-trips a caret through two editors holding the same value', () => {
    const value = 'fix ![](/tmp/shot.png) the header';
    const source = editorFor(value);

    // Caret just after "the " in the trailing text node.
    const trailing = source.childNodes[2] as Text;
    const range = document.createRange();
    range.setStart(trailing, ' the '.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const offset = getCaretOffset(source);
    // 'fix ' + the full marker + ' the '
    expect(offset).toBe('fix ![](/tmp/shot.png) the '.length);

    // The same offset lands in the same place in a freshly built editor.
    const target = editorFor(value);
    setCaretOffset(target, offset!);
    expect(getCaretOffset(target)).toBe(offset);

    const placed = window.getSelection()!.getRangeAt(0);
    expect(placed.startContainer.textContent).toBe(' the header');
    expect(placed.startOffset).toBe(' the '.length);
  });

  test('parks the caret at the end when the offset runs past the content', () => {
    const target = editorFor('short');
    setCaretOffset(target, 999);
    expect(getCaretOffset(target)).toBe('short'.length);
  });

  test('reports no offset when the selection is outside the editor', () => {
    const editor = editorFor('text');
    const outside = document.createElement('div');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);

    const range = document.createRange();
    range.setStart(outside.firstChild!, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getCaretOffset(editor)).toBeNull();
  });
});
