import { getCollection, type CollectionEntry } from 'astro:content';
import type { System } from './components/writing/coverGeometry';

export type Post = CollectionEntry<'writing'>;
export type CoverSpec = Post['data']['cover'] & { system: System };

export const AUTHOR = { name: 'Prentice Bjerkeseth' };

export const postDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export async function listAllPosts(): Promise<Post[]> {
  const posts = await getCollection('writing');
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** The posts the site lists, links to and syndicates. Drafts appear only in dev. */
export async function listPosts(): Promise<Post[]> {
  return (await listAllPosts()).filter((post) => import.meta.env.DEV || !post.data.draft);
}
