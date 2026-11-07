/**
 * The back cards of the stack on screen, in the order ⌘1–9 number them. The
 * layout on screen writes this as it renders, since only it knows where each
 * card sits.
 */
let positions: string[] = [];

export function setStackPositions(ptyIds: string[]): void {
  positions = ptyIds;
}

export function getStackPositions(): string[] {
  return positions;
}
