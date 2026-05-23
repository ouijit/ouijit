// @vitest-environment jsdom
import { describe, test, expect } from 'vitest';
import { parseDescription, serializeDescriptionDOM, createAttachmentChip } from '../utils/descriptionAttachments';

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
