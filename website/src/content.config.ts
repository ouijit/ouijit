import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writing = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    cover: z
      .object({
        motif: z.enum(['fan', 'matrix', 'coil']).default('fan'),
        wash: z.enum(['prism', 'iris', 'graphite']).default('prism'),
        angle: z.number().default(150),
      })
      .default({}),
  }),
});

export const collections = { writing };
