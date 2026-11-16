import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderPlanMarkdown } from '../../utils/renderPlanMarkdown';

// Stub shiki — full grammar loading is irrelevant to the mermaid tests
// and slow under jsdom.
vi.mock('shiki', () => ({
  createHighlighter: vi.fn(async () => ({
    getLoadedLanguages: () => ['typescript', 'javascript'],
    codeToHtml: (text: string, _opts: { lang: string }) => `<pre class="shiki"><code>${text}</code></pre>`,
  })),
}));

// Stub electron-log/renderer to avoid IPC bridge during tests.
vi.mock('electron-log/renderer', () => {
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: { scope: () => log } };
});

const mermaidRender = vi.fn(async (id: string, _src: string) => ({
  svg: `<svg data-id="${id}"><g>diagram</g></svg>`,
}));
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: (...args: [string, string]) => mermaidRender(...args),
  },
}));

const noLocalImages = async () => null;

describe('renderPlanMarkdown — mermaid support', () => {
  beforeEach(() => {
    mermaidRender.mockClear();
  });

  it('renders a mermaid code block as an inlined SVG diagram', async () => {
    const md = ['Heading text.', '', '```mermaid', 'graph TD', '  A --> B', '```', ''].join('\n');

    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(mermaidRender).toHaveBeenCalledOnce();
    expect(mermaidRender.mock.calls[0][1]).toBe('graph TD\n  A --> B');
    expect(html).toContain('class="mermaid-diagram"');
    expect(html).toContain('<svg');
    expect(html).toContain('diagram');
    expect(html).not.toContain('__OUIJIT_MERMAID_');
  });

  it('leaves non-mermaid code blocks alone', async () => {
    const md = ['```typescript', 'const x = 1;', '```'].join('\n');

    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(mermaidRender).not.toHaveBeenCalled();
    expect(html).toContain('class="shiki');
    expect(html).toContain('const x = 1;');
  });

  it('falls back to a plain code block when mermaid throws', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('parse error'));

    const md = ['```mermaid', 'not a real diagram', '```'].join('\n');
    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(html).not.toContain('mermaid-diagram');
    expect(html).toContain('not a real diagram');
  });

  it('handles multiple mermaid blocks in one document', async () => {
    const md = [
      '```mermaid',
      'graph TD; A-->B',
      '```',
      '',
      'middle prose',
      '',
      '```mermaid',
      'graph LR; X-->Y',
      '```',
    ].join('\n');

    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(mermaidRender).toHaveBeenCalledTimes(2);
    const matches = html.match(/class="mermaid-diagram"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('renders mermaid blocks nested inside a blockquote', async () => {
    const md = ['> intro line', '>', '> ```mermaid', '> graph TD; A-->B', '> ```'].join('\n');

    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(mermaidRender).toHaveBeenCalledOnce();
    expect(html).toContain('class="mermaid-diagram"');
    expect(html).toMatch(/<blockquote[^>]*>[\s\S]*mermaid-diagram[\s\S]*<\/blockquote>/);
  });

  it('passes typical mermaid SVG output through DOMPurify intact', async () => {
    // Lock-in: with htmlLabels: false, mermaid emits plain SVG (text/g/path/rect)
    // and DOMPurify needs no extra config. Asserts we did not regress to a
    // setup that requires ADD_TAGS or weakened sanitization.
    mermaidRender.mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 100 50"><g><rect x="0" y="0" width="100" height="50"/><text x="50" y="25">hello</text></g></svg>',
    });

    const md = ['```mermaid', 'graph TD; A-->B', '```'].join('\n');
    const html = await renderPlanMarkdown(md, noLocalImages);

    expect(html).toContain('<svg');
    expect(html).toContain('<text');
    expect(html).toContain('hello');
    expect(html).toContain('<rect');
  });
});

describe('renderPlanMarkdown — images', () => {
  it('inlines images that live beside the file and leaves remote ones alone', async () => {
    const asked: string[] = [];
    const loadLocalImage = async (src: string) => {
      asked.push(src);
      return src.includes('missing') ? null : `data:image/png;base64,${btoa(src)}`;
    };

    const md = [
      '![diagram](./docs/diagram.png)',
      '![remote](https://example.com/remote.png)',
      '<img src="shots/raw html.png" alt="raw">',
      '![gone](missing.png)',
      '<picture><source srcset="dark.png 1x, dark@2x.png 2x"><img src="light.png" srcset="light@2x.png 2x" alt="themed"></picture>',
      '<img src="https://example.com/a.png" srcset="https://example.com/a@2x.png 2x" alt="remote set">',
    ].join('\n\n');

    const container = document.createElement('div');
    container.innerHTML = await renderPlanMarkdown(md, loadLocalImage);
    const src = (alt: string) => container.querySelector(`img[alt="${alt}"]`)?.getAttribute('src');

    expect(asked.sort()).toEqual(['./docs/diagram.png', 'light.png', 'missing.png', 'shots/raw html.png']);
    expect(src('themed')).toBe(`data:image/png;base64,${btoa('light.png')}`);
    expect(Array.from(container.querySelectorAll('[srcset]'), (el) => el.getAttribute('alt'))).toEqual(['remote set']);
    expect(src('diagram')).toBe(`data:image/png;base64,${btoa('./docs/diagram.png')}`);
    expect(src('raw')).toBe(`data:image/png;base64,${btoa('shots/raw html.png')}`);
    expect(src('remote')).toBe('https://example.com/remote.png');
    expect(src('gone')).toBeNull();
  });
});
