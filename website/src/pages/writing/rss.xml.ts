import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { listPosts } from '../../writing';

export const GET: APIRoute = async ({ site }) => {
  const posts = await listPosts();
  return rss({
    title: 'Ouijit · Writing',
    description: 'Posts, technical write-ups and essays on running coding agents in parallel.',
    site: site ?? 'https://ouijit.com',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/writing/${post.id}/`,
    })),
  });
};
