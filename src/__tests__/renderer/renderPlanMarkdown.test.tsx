import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { renderPlanMarkdown } from '../../utils/renderPlanMarkdown';

describe('renderPlanMarkdown — mermaid support', () => {
  beforeEach(() => {
    mermaidRender.mockClear();
  });

  it('renders a mermaid code block as an inlined SVG diagram', async () => {
    const md = ['Heading text.', '', '```mermaid', 'graph TD', '  A --> B', '```', ''].join('\n');

    const html = await renderPlanMarkdown(md);

    expect(mermaidRender).toHaveBeenCalledOnce();
    expect(mermaidRender.mock.calls[0][1]).toBe('graph TD\n  A --> B');
    expect(html).toContain('class="mermaid-diagram"');
    expect(html).toContain('<svg');
    expect(html).toContain('diagram');
    expect(html).not.toContain('__OUIJIT_MERMAID_');
  });

  it('leaves non-mermaid code blocks alone', async () => {
    const md = ['```typescript', 'const x = 1;', '```'].join('\n');

    const html = await renderPlanMarkdown(md);

    expect(mermaidRender).not.toHaveBeenCalled();
    expect(html).toContain('class="shiki"');
    expect(html).toContain('const x = 1;');
  });

  it('falls back to a plain code block when mermaid throws', async () => {
    mermaidRender.mockRejectedValueOnce(new Error('parse error'));

    const md = ['```mermaid', 'not a real diagram', '```'].join('\n');
    const html = await renderPlanMarkdown(md);

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

    const html = await renderPlanMarkdown(md);

    expect(mermaidRender).toHaveBeenCalledTimes(2);
    const matches = html.match(/class="mermaid-diagram"/g) ?? [];
    expect(matches.length).toBe(2);
  });
});
