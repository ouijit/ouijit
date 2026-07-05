/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// Injected by vite.renderer.config.ts: absolute repo/worktree path when
// served by the dev server, null in production builds.
declare const __DEV_WORKTREE_PATH__: string | null;
