---
name: writing-cover
description: Make the cover art for a post under website/src/content/writing. Use this whenever a post is being added or published without a cover, whenever someone asks for cover art, a thumbnail, a hero image or "art" for a Writing post or the writing index, and whenever a new cover motif is needed. Covers here are generated line systems on the site's washes, not illustrations or icons, so do not reach for an image tool or hand-draw an SVG without reading this first.
---

# Writing covers

A cover is one generated line system, drawn in dark glass on one of the site's
colour washes with its grain. It is rendered by `website/src/components/writing/Cover.astro`
from three values in a post's frontmatter:

```yaml
cover:
  motif: fan        # fan | matrix | coil, or a motif you add
  wash: prism       # prism | iris | graphite
  angle: 150        # direction of the wash sweep, in degrees
```

The index card and the post's hero both render the same cover, so one choice
covers both. The look is deliberate and took several rounds to reach; the
rules below are what survived.

## What a system is

The reference is the `fan`: twenty-two lines leaving the left edge at equal
intervals and meeting at one point on the right. Take it apart and every
cover needs the same four things.

- **Density.** Twenty marks at the very least, usually more. A system reads
  as texture first and as an idea second; below that count it reads as a
  drawing of something, and drawings are what we rejected.
- **One progression.** Equal spacing, or spacing that tightens by a constant
  ratio, or sizes that grow along one axis, or a dash that lengthens. Exactly
  one rule, applied to every mark, so the eye can feel it.
- **One disturbance.** The point the lines meet, the one column where the
  dots swell, the one ellipse drawn solid. This is where the post's idea sits.
  A system with no disturbance is wallpaper; a system with two is noise.
- **Occupancy.** Marks cover sixty to eighty percent of the frame, with at
  least 60px of margin on every side at the 800×450 viewBox. A large empty
  outline, or a small figure floating in colour, fails this.

The system is drawn in two inks: `rgba(15,15,17,0.72)` for the disturbance
and `rgba(15,15,17,0.34)` for everything else. Nothing else is on the cover.

## Metaphor, not depiction

The post's idea goes into how the repetition behaves, never into what the
marks resemble. A post about a stack of terminals does not get rectangles
arranged in a stack; it gets a progression where one element in a run is
singled out and the rest fall off behind it. A post about a human gate does
not get a gate; it gets a run whose character changes at one column. If the
cover could be captioned with the post's noun, start over.

## Wash and contrast

- **Prism** is warm and loud, **iris** is cool. Both take the dark ink well
  and suit systems of many thin marks.
- **Graphite** is quiet, and the dark ink nearly disappears on it; what
  shows is the glass highlight along each mark's lower edge. Use it only for
  systems of large or dense marks (dots of radius 4 and up, close-set lines)
  and check the card screenshot before keeping it.
- Vary the wash across neighbouring posts so the index is not one colour.
- The angle turns the sweep. Put its brightest stop away from the
  disturbance so the strong ink sits on the wash's darker part.

## What was tried and rejected

Do not walk these paths again; each was built, looked at, and turned down.

- Line diagrams with labelled boxes and arrows. Diagrams belong in the post
  body as figures, never as the cover.
- A single large Unicode glyph (`⑂`, `>_`, `⌘`), flat or embossed. Reads as a
  basic icon.
- Compositions of glyphs: character fields, box-drawing figures, stacked
  glyphs. Complexity without craft; looked sloppy.
- Depictions: six receding rectangles for a post about stacked terminals,
  rows broken by a vertical bar for a post about a human gate. Correct
  reasoning, sparse result; both failed density and occupancy.
- Monochrome hairlines on a black field. That is Linear's look, and the brief
  was inspiration, not imitation. Our marks are dark on colour.
- Photographic, collage or AI-generated illustration. Not something this site
  can produce consistently.

## Procedure

1. Read the post. Write its idea as one sentence about behaviour: what
   converges, repeats, splits, swells, is held or falls behind. That sentence
   picks the progression and the disturbance.
2. Sketch three candidate systems, as geometry, not prose. Each is a loop
   or two pushing into `lines`, `dots` or `ellipses` in
   `website/src/components/writing/Cover.astro`. Reuse `fan`, `matrix` or
   `coil` as one of the three when it fits. Give each its own motif name and
   add the names to the `cover.motif` enum in `website/src/content.config.ts`.
3. Render all three with the preview script, pointing each at the post by
   editing its frontmatter in turn:

   ```sh
   node .claude/skills/writing-cover/scripts/preview.mjs <slug>
   ```

   Judge each against the four requirements above at card size, where
   failures show first. Drop any that fail; fix or replace rather than
   lowering the bar.
4. Show the survivors' card and hero screenshots with their frontmatter, and
   say which you would pick and why. The final call is not yours; cover art
   is judged by eye.
5. After the pick, remove the motifs that were not chosen from the component
   and the enum, so the set stays small and every motif in it has shipped.

## Adding a motif well

A motif is a function of nothing: no randomness, no post-specific text, so the
same frontmatter always renders the same cover and the set stays coherent.
Keep stroke widths at 2 for lines and radii between 1.2 and 6 for dots, so
new motifs sit beside the old ones as one family. If you find yourself
wanting labels, arrows or more than one visual idea, the post wants a figure
in its body instead; write that as a Markdown image with a caption and keep
the cover to one system.
