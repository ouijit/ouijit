import type { CSSProperties } from 'react';

/** The wash layer for a `.desk-wash` desk; the palette comes from the
 * desk's `desk-wash--*` modifier class. */
export function DeskWash({ style }: { style?: CSSProperties }) {
  return (
    <div className="desk-wash-field" aria-hidden="true" style={style}>
      <span className="desk-wash-grain" />
    </div>
  );
}
