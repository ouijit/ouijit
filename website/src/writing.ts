import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'writing'>;

export const AUTHOR = { name: 'Prentice Bjerkeseth', url: 'https://github.com/pbjer' };

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
