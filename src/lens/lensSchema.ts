/**
 * Handed to the agent CLI, so a reply is either this or a failed run. What the
 * fields *mean* is still the prompt's job: a schema can say `ranges` is a pair of
 * numbers, not that they are new-file line numbers.
 *
 * Every field is required and every optional one nullable, which is what Codex's
 * strict mode demands; `parseLens` reads a null as an absent field.
 */
export const LENS_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Names this part of the change — a noun phrase, not a sentence. Under about 35 characters.',
          },
          summary: { type: ['string', 'null'], description: 'One line on why these belong together' },
          slices: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'A path from the file list, exactly as given' },
                ranges: {
                  type: ['array', 'null'],
                  description: 'New-file line ranges, or null to claim the whole file',
                  items: {
                    type: 'array',
                    items: { type: 'integer' },
                    minItems: 2,
                    maxItems: 2,
                  },
                },
              },
              required: ['path', 'ranges'],
              additionalProperties: false,
            },
          },
        },
        required: ['title', 'summary', 'slices'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const;
