/** The wash layer for a `.desk-wash` desk; the palette comes from the
 * desk's `desk-wash--*` modifier class. */
export function DeskWash() {
  return (
    <div className="desk-wash-field" aria-hidden="true">
      <span className="desk-wash-grain" />
    </div>
  );
}
