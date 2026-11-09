import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'writing'>;
export type CoverSpec = Post['data']['cover'];

export const AUTHOR = { name: 'Prentice Bjerkeseth', url: 'https://github.com/pbjer', avatar: '/assets/prentice.jpg' };

export const postDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export async function listPosts(): Promise<Post[]> {
  const posts = await getCollection('writing');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function readingMinutes(post: Post): number {
  const words = (post.body ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
