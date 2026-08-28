import type { DiffSubject } from './subject';
import type { LensChangedPayload } from './subjectKeys';

let announce: (change: LensChangedPayload) => void = () => {};

/** Until this is wired at startup, a write announces nothing. */
export function setLensAnnouncer(push: (change: LensChangedPayload) => void): void {
  announce = push;
}

/**
 * Every write of a lens ends here, whichever process asked for it: a pane that
 * did not start the run has nothing else to clear its spinner.
 */
export function announceLensChanged(subject: DiffSubject): void {
  announce({ projectPath: subject.projectPath, subjectKey: subject.key });
}
