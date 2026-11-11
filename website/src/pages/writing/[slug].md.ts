import type { APIRoute, GetStaticPaths } from 'astro';
import { listPosts, type Post } from '../../writing';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await listPosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
};

export const GET: APIRoute = ({ props }) => {
  const { post } = props as { post: Post };
  const header = `<!-- https://ouijit.com/writing/${post.id}/ · rendered as Markdown for agents and LLMs -->\n\n`;
  const body = `# ${post.data.title}\n\n${post.body ?? ''}\n`;
  return new Response(header + body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
