import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const wash = z.enum(['prism', 'iris', 'graphite']);
const field = z.object({ wash, angle: z.number() });
const layer = z.enum(['under', 'over']).default('under');
const shape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('circle'),
    wash,
    angle: z.number().default(150),
    cx: z.number(),
    cy: z.number(),
    r: z.number(),
  }),
  z.object({ kind: z.literal('polygon'), wash, angle: z.number().default(150), layer, points: z.string() }),
  z.object({
    kind: z.literal('rect'),
    wash,
    angle: z.number().default(150),
    layer,
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    rotate: z.number().default(0),
  }),
]);
const system = z
  .object({
    motif: z.enum(['fan', 'rows', 'dots', 'columns', 'coil']),
    ink: z.enum(['dark', 'light']).optional(),
  })
  .passthrough();

export const coverSchema = z.object({
  field: field.default({ wash: 'prism', angle: 150 }),
  shape: shape.optional(),
  system: system.default({ motif: 'fan' }),
});

const writing = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    cover: coverSchema.default({}),
  }),
});

export const collections = { writing };
