/**
 * The shape a lens run is held to, as JSON Schema.
 *
 * Handed to the agent CLI rather than described in the prompt, so a reply is
 * either this or a failed run. What the prompt still has to say is what the
 * fields *mean* — a schema can say `ranges` is a pair of numbers and cannot say
 * they are new-file line numbers.
 *
 * Every field is required and every optional one is nullable, which is what
 * Codex's strict mode demands; `parseLens` reads a null as an absent field, so
 * the two agree without either being bent to suit the other.
 */
export const LENS_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name for this part of the change' },
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
