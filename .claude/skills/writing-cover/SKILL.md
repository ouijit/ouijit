---
name: writing-cover
description: Make the cover art for a post under website/src/content/writing. Use this whenever a post is being added or published without a cover, whenever someone asks for cover art, a thumbnail, a hero image or "art" for a Writing post or the writing index, and whenever a cover needs reworking. Covers here are compositions of the site's colour washes and generated line systems, declared in frontmatter, not illustrations or icons, so do not reach for an image tool or hand-draw an SVG without reading this first.
---

# Writing covers

A cover is a composition of three layers, all declared in the post's
frontmatter and rendered by `website/src/components/writing/Cover.astro`:

```yaml
cover:
  field: { wash: prism, angle: 150 }
  shape: { kind: circle, wash: graphite, angle: 120, cx: 800, cy: 225, r: 240 }
  system: { motif: fan, count: 23, tx: 560, ty: 225, spread: 4 }
```

- **field**: the background, one of the site's washes (`prism`, `iris`,
  `graphite`) swept at an angle.
- **shape** (optional): one form, a `circle`, a `rect` (square or rectangle,
  optionally rotated) or a `polygon`, filled with a *different* wash than the
  field. When there is one it is large and anchored: it touches an edge or
  bleeds off one, and the system runs into it or past it. `layer: over` draws
  it on top of the marks. The first post has no shape; the fan carries it.
- **system**: a generated run of marks in glass ink. Motifs and their
  parameters are in `website/src/components/writing/coverGeometry.ts`. The ink
  defaults to dark on prism and iris and light on graphite; `ink: light` or
  `ink: dark` overrides it.

The same spec renders the index card and the post's hero. The look took
several rounds to find. `references/compositions.md` holds the compositions
that were approved and the ones that were not; start from an approved one and
vary it. The rules below are a vocabulary to work in, not a checklist: the
first cover should not dictate the second, and two covers that could be
mistaken for each other are a failure of the set.

## What reads as right

- **Two surfaces meeting, at scale.** One wash against another, a graphite
  half-disc on prism or a prism square on graphite, gives the eye a place to
  land and the system something to react to. The shape is big, a third to a
  half of the frame, and it is cut by an edge of the cover. Vary what it is
  and where it sits from post to post: a disc off the right, a slab off the
  right, a rotated square off the bottom-left, a band off top and bottom, a
  disc off the left. Small shapes floating in the field read as clip art.
- **Asymmetry.** Centred compositions were the weakest in every round. Let the
  shape sit in a corner or off an edge, weight the marks to one side, let the
  focal point fall off-centre.
- **A system, not a drawing.** The marks come from arithmetic: a fan of lines
  meeting at a point, rows of dashes turning solid at one column, dots
  swelling toward one column. Twenty marks or more, one rule of spacing or
  size, one place where the rule breaks. That break is where the post's idea
  sits.
- **Metaphor through behaviour.** A post about a stack does not get stacked
  rectangles; it gets a run where one element is singled out and the rest
  fall away. If the cover could be captioned with the post's noun, start over.
- **The site's own materials.** The washes are the homepage's OKLCH sweeps,
  the grain is the homepage's, the glass edge is the bevel every panel has.
  A cover that could sit on another company's blog is wrong.

## What was tried and rejected

Each of these was built, looked at, and turned down. Do not rebuild them.

- Labelled diagrams with boxes and arrows. Those belong in the post body as
  figures.
- A single large Unicode glyph, flat or embossed. Reads as a basic icon.
- Compositions of glyphs: character fields, box-drawing figures, stacked
  glyphs. Complexity without craft.
- White hairlines on a black field. That is another company's look; the brief
  was inspiration, not imitation.
- Depictions: receding rectangles for a post about stacks, rows broken by a
  bar for a post about a gate. Correct reasoning, sparse result.
- Sparse or centred systems on a plain field. Technically clean, visually
  empty.
- Small floating shapes beside a system, and a shape in the same place on
  every cover. The first reads as clip art, the second as a template.
- Field-only covers whose system is thin or has no focal point in the frame.
  The original fan works alone because it is dense and converges inside the
  cover; a fan to a point off the canvas and loose columns did not.
- A highlight edge on shapes. It read as a border; shapes carry only a soft
  shadow.

## Procedure

1. Read the post. Write its idea as one sentence about behaviour: what
   converges, repeats, splits, swells, is held or falls behind. That picks
   the system and its break.
2. Write four to six candidate specs into `website/.cover-sketches.json`
   (gitignored), each `{ "label": "...", "cover": { field, shape?, system } }`.
   Vary field wash, shape kind and placement, and which side carries the
   weight, and check the set against the covers already on the index so no
   two are near twins. Reuse motifs with different parameters before adding
   one.
3. Render them:

   ```sh
   node .claude/skills/writing-cover/scripts/preview.mjs <slug>
   ```

   This builds the site and screenshots the sketch page (every candidate at
   hero and card size side by side), the post's current hero and card, and
   the hero with the pointer parked near a corner, to check the live clamp.
   Judge at card size first, where failures show first: contrast of ink on
   wash, legibility of the system, whether the shape still reads as a shape.
4. Show the sketch screenshot and say which you would pick and why. The
   final call is not yours; cover art is judged by eye.
5. Put the chosen spec into the post's frontmatter, rerun the preview to
   confirm, and delete the sketches file.
6. Write the post's link-preview image, the cover cropped to 1200×630,
   with `node .claude/skills/writing-cover/scripts/og.mjs`, and commit the
   PNG it writes to `website/public/assets/og/`. Rerun it whenever a cover
   changes.

## The live layer

On devices with a pointer, the break follows it. `focusSystem` in
`coverGeometry.ts` moves a system's break to a point in cover coordinates:
the fan re-aims its vanishing point, the dot matrix swells under the pointer,
the rows turn solid where it is, the coil's solid ring and the strong column
are the ones it is over. The wash tilts a few degrees and a shape drifts
against the pointer. On leave it eases back to the designed composition, so
the static cover is always the approved one. Reduced motion and touch get the
static cover.

This is why a system needs a break: a system without one has nothing to move.
Each case in `focusSystem` clamps the pointer so the system cannot collapse
into a sliver or leave the frame; set the clamp from the motif's own
geometry, and test it at the corners of the cover.

## Adding a motif

Only when no existing motif's parameters can express the idea. A motif is a
pure function of its parameters in `coverGeometry.ts`: no randomness, no
post-specific text. Push into `lines`, `dots` or `ellipses`, mark the break
with `strong: true`, keep every mark at least 60px inside the 800×450
viewBox, add a case to `focusSystem` that moves the break to the pointer with
a sensible clamp, and add the name to the `system.motif` enum in
`website/src/content.config.ts`. Stroke widths stay at 2 for lines and radii
between 1.2 and 6 for dots so new motifs sit beside the old ones as one family.
