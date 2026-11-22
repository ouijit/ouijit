import type { CSSProperties } from 'react';

type Fades = { left?: number; right?: number; bottom?: number };

function mask({ left = 0, right = 0, bottom = 0 }: Fades): string {
  return [
    `linear-gradient(to right, transparent, black ${left}px, black calc(100% - ${right}px), transparent)`,
    `linear-gradient(to bottom, black calc(100% - ${bottom}px), transparent)`,
  ].join(', ');
}

function Layer({ blur, fades, tint, color }: { blur: number; fades: Fades; tint?: number; color: string }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        backdropFilter: `blur(${blur}px)`,
        background: tint ? `color-mix(in srgb, var(${color}) ${tint}%, transparent)` : undefined,
        maskImage: mask(fades),
        maskComposite: 'intersect',
      }}
    />
  );
}

const widen = ({ left, right, bottom }: Fades): Fades => ({
  left: left && left * 1.6,
  right: right && right * 1.6,
  bottom,
});

/**
 * A blur filling its positioned parent, for controls that sit over content
 * scrolling under them. It fades out over the given sides; a fine blur with a
 * little of the surface's colour, and a wider one fading out further, so the
 * blurred area has no edge.
 */
export function SoftBlur({
  fades,
  color = '--color-background',
  className = 'inset-0',
  style,
}: {
  fades: Fades;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden className={`absolute pointer-events-none ${className}`} style={style}>
      <Layer blur={4} fades={fades} tint={30} color={color} />
      <Layer blur={10} fades={widen(fades)} color={color} />
    </div>
  );
}
