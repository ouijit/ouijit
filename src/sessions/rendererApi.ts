/**
 * Renderer-facing session API surface (task #463).
 *
 * Augments {@link ElectronAPI} with `window.api.sessions` — the renderer's handle
 * on the authoritative session stream ({@link SessionsAPI}). Declared here rather
 * than inline in types.ts on purpose: the Session model depends on `PtyId` from
 * types.ts, so importing {@link SessionsAPI} back into types.ts would form an
 * import cycle (see the note at the top of types.ts). Module augmentation adds
 * the field without the back-edge.
 */

import type { SessionsAPI } from './model';

declare module '../types' {
  interface ElectronAPI {
    /** Authoritative session stream — list/get/attach/detach/reattach + event subscribe. */
    sessions: SessionsAPI;
  }
}
