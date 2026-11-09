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

## What makes a cover right

- **One system, exactly spaced.** Every mark comes from a few lines of
  arithmetic: a fan of lines meeting at a point, rows of dots swelling at one
  column, a run of dashed ellipses with one solid. Regular spacing is what reads
  as made-with-care. Hand-placed shapes read as sloppy at thumbnail size.
- **Restraint.** The wash and grain carry the colour and texture. The system is
  a single idea in two inks: `rgba(15,15,17,0.72)` for the subject and
  `rgba(15,15,17,0.34)` for the supporting marks. Nothing else is on the cover.
- **Abstract, with a reason.** The system should rhyme with the post's idea
  without labelling it. The fan is many worktrees converging on one port. A
  reader should feel that, not read it.
- **The site's own materials.** The washes are the homepage's OKLCH sweeps,
  the grain is the homepage's, the glass edge is the bevel used on every panel.
  A cover that could sit on another company's blog is wrong.

## What was tried and rejected

Do not walk these paths again; each was built, looked at, and turned down.

- Line diagrams with labelled boxes and arrows. Diagrams belong in the post
  body as figures, never as the cover.
- A single large Unicode glyph (`⑂`, `>_`, `⌘`), flat or embossed. Reads as a
  basic icon.
- Compositions of glyphs: character fields, box-drawing figures, stacked
  glyphs. Complexity without craft; looked sloppy.
- Monochrome hairlines on a black field. That is Linear's look, and the brief
  was inspiration, not imitation. Our marks are dark on colour.
- Photographic, collage or AI-generated illustration. Not something this site
  can produce consistently.

## Procedure

1. Read the post. Name its one idea in a sentence: what converges, repeats,
   stacks, splits or is shared. That sentence picks the system.
2. Pick a motif. If `fan`, `matrix` or `coil` fits, use it. If none does, add
   one: a new branch in `Cover.astro` that pushes into `lines`, `dots` or
   `ellipses` from a loop or two. Keep the geometry inside the 800×450 viewBox
   with at least 60px of margin, stroke widths of 2 for lines and 1.2 to 6 for
   dots, and one element in the strong ink with the rest in the weak ink. Add
   the motif name to the `cover.motif` enum in `website/src/content.config.ts`.
3. Pick a wash. Prism is warm and loud, iris is cool, graphite is quiet and
   suits a post about caution or limits. Vary across neighbouring posts so the
   index does not become one colour.
4. Pick an angle. Any value works; use it to put the brightest part of the
   sweep away from the system's focal point so the marks stay legible.
5. Set the frontmatter, then run the preview script to build the site and
   screenshot the card and the hero:

   ```sh
   node .claude/skills/writing-cover/scripts/preview.mjs <slug>
   ```

   Look at both images. Check that the system is legible at card size, that
   nothing touches the edges, and that the grain is not louder than the marks.
6. Show the two screenshots and the frontmatter before committing. Cover art
   is judged by eye and the final call is not yours.

## Adding a motif well

A motif is a function of nothing: no randomness, no post-specific text, so the
same frontmatter always renders the same cover and the set stays coherent. If
you find yourself wanting labels, arrows or more than one visual idea, the
post wants a figure in its body instead; write that as a Markdown image with a
caption and keep the cover to one system.
