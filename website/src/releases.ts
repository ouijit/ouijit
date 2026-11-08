import { createMarkdownProcessor } from '@astrojs/markdown-remark';

export interface Release {
  tag: string;
  url: string;
  publishedAt: Date;
  html: string;
}

interface ApiRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  body: string | null;
}

const RELEASES_URL = 'https://api.github.com/repos/ouijit/ouijit/releases?per_page=100';

// GitHub's generated notes open with a "What's Changed" heading and close with
// a compare link; the page supplies both itself.
function stripReleaseChrome(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^##\s+What's/.test(line.trim()) && !/^\*\*Full Changelog\*\*/.test(line.trim()))
    .join('\n')
    .trim();
}

export async function fetchReleases(): Promise<Release[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const response = await fetch(RELEASES_URL, { headers });
  if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
  const releases = (await response.json()) as ApiRelease[];

  const markdown = await createMarkdownProcessor();
  const published = releases.filter((r) => !r.draft && !r.prerelease && r.body);
  return Promise.all(
    published.map(async (r) => ({
      tag: r.tag_name,
      url: r.html_url,
      publishedAt: new Date(r.published_at),
      html: (await markdown.render(stripReleaseChrome(r.body!))).code,
    })),
  );
}
