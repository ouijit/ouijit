# Compositions that were approved, and ones that were not

Approved by Prentice on 2026-11-09. Start a new cover from one of these and
vary it; do not reproduce one exactly for a second post.

## Approved

The first post's cover, and the reference for the whole set. No shape: the
fan alone on prism, twenty-two lines leaving the left edge at equal intervals
and meeting at one point low on the right.

```yaml
field: { wash: prism, angle: 150 }
system: { motif: fan }
```

The same fan running into a graphite half-disc off the right edge:

```yaml
field: { wash: prism, angle: 150 }
shape: { kind: circle, wash: graphite, angle: 120, cx: 800, cy: 225, r: 240 }
system: { motif: fan, count: 23, tx: 560, ty: 225, spread: 4 }
```

A graphite slab off the right edge of prism, the fan running into it:

```yaml
field: { wash: prism, angle: 150 }
shape: { kind: rect, wash: graphite, angle: 120, x: 560, y: -40, w: 420, h: 530 }
system: { motif: fan, count: 23, tx: 560, ty: 225, spread: 4 }
```

A prism square rotated twenty degrees, off the bottom-left of graphite, light
columns beside it:

```yaml
field: { wash: graphite, angle: 200 }
shape: { kind: rect, wash: prism, angle: 60, x: -80, y: 150, w: 400, h: 400, rotate: 20 }
system: { motif: columns, x0: 380, loosen: 0.7, strong: 1 }
```

A graphite disc off the top-right of prism, dots swelling toward it:

```yaml
field: { wash: prism, angle: 40 }
shape: { kind: circle, wash: graphite, angle: 150, cx: 740, cy: 40, r: 260 }
system: { motif: dots, x0: 60, x1: 520, y0: 150, y1: 400, cols: 32, rows: 9, swellAt: 31 }
```

A prism band off the top and bottom at the left of iris, the coil overlapping
its edge:

```yaml
field: { wash: iris, angle: 20 }
shape: { kind: rect, wash: prism, angle: 100, x: -40, y: -40, w: 330, h: 530 }
system: { motif: coil, cx: 470, cy: 225, count: 11, step: 50, solid: 2 }
```

An iris disc off the left edge of graphite, a light fan arriving from the
right:

```yaml
field: { wash: graphite, angle: 160 }
shape: { kind: circle, wash: iris, angle: 200, cx: 40, cy: 225, r: 300 }
system: { motif: fan, count: 23, x: 740, y0: 50, y1: 410, tx: 340, ty: 225, spread: 4 }
```

## Not approved

- A graphite triangle standing on the bottom edge, drawn over the rows. Too
  symmetrical, and the shape dominates instead of meeting the system.
- Two field-only sketches: a fan to a point off the canvas, and columns
  tightening to one side. The original fan works without a shape because it
  is dense and has one unmistakable focal point inside the frame; these two
  had neither. Field-only is fine when the system carries the cover alone.
- Small floating shapes (a square or triangle sitting beside a system,
  touching nothing). Read as clip art on a gradient.
- Shapes with a highlight edge. Read as a border.
