import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'path';
import fs from 'fs';

// Helper to copy native modules to the packaged app.
// We need this because node-pty (a native module with .node binaries) fails to load
// from inside ASAR archives. Electron's AutoUnpackNativesPlugin didn't reliably solve
// this, so we manually copy native modules after packaging.
const copyRecursive = (src: string, dest: string) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const config: ForgeConfig = {
  packagerConfig: {
    // Disabled ASAR because native modules (node-pty) don't load reliably from archives.
    // Node's native module loader expects .node files on the real filesystem.
    asar: false,
    icon: './src/assets/icons/icon',
  },
  rebuildConfig: {},
  hooks: {
    // Vite bundles JS but excludes native modules. We manually copy them post-package
    // so they're available at runtime in the packaged app.
    postPackage: async (_config, options) => {
      const platform = options.platform;
      let appPath: string;

      if (platform === 'darwin') {
        // macOS: look for .app bundle
        const outputDir = options.outputPaths[0];
        const appBundle = fs.readdirSync(outputDir).find(f => f.endsWith('.app'));
        if (!appBundle) {
          console.error('Could not find .app bundle');
          return;
        }
        appPath = path.join(outputDir, appBundle, 'Contents', 'Resources', 'app');
      } else {
        // Windows/Linux
        appPath = path.join(options.outputPaths[0], 'resources', 'app');
      }

      const nodeModulesDest = path.join(appPath, 'node_modules');

      const modulesToCopy = ['node-pty'];
      for (const mod of modulesToCopy) {
        const src = path.join(__dirname, 'node_modules', mod);
        const dest = path.join(nodeModulesDest, mod);
        console.log(`Copying ${mod} to ${dest}`);
        copyRecursive(src, dest);
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // These must be disabled since we're not using ASAR (see packagerConfig.asar above)
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
