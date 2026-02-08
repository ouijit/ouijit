import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { notarize } from '@electron/notarize';
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
    osxSign: process.env.SKIP_SIGN
      ? undefined
      : {
          optionsForFile: () => ({
            entitlements: './entitlements.mac.plist',
          }),
        },
    // Copy native modules BEFORE signing (afterCopy runs before osxSign)
    afterCopy: [
      (buildPath, _electronVersion, platform, _arch, callback) => {
        const nodeModulesDest = path.join(buildPath, 'node_modules');

        const modulesToCopy = ['node-pty', 'koffi'];
        for (const mod of modulesToCopy) {
          const src = path.join(__dirname, 'node_modules', mod);
          const dest = path.join(nodeModulesDest, mod);
          console.log(`Copying ${mod} to ${dest}`);
          copyRecursive(src, dest);
        }

        // Copy bundled limactl binary
        const limactlSrc = path.join(__dirname, 'resources', 'bin', 'limactl');
        if (fs.existsSync(limactlSrc)) {
          const binDest = path.join(buildPath, '..', 'bin');
          fs.mkdirSync(binDest, { recursive: true });
          fs.copyFileSync(limactlSrc, path.join(binDest, 'limactl'));
          fs.chmodSync(path.join(binDest, 'limactl'), 0o755);
          console.log(`Copied limactl to ${binDest}`);
        }

        callback();
      },
    ],
  },
  rebuildConfig: {},
  hooks: {
    postPackage: async (_config, options) => {
      // Only notarize macOS builds when not skipping
      if (options.platform !== 'darwin' || process.env.SKIP_NOTARIZE) {
        return;
      }

      const appPath = path.join(options.outputPaths[0], 'Ouijit.app');

      if (!fs.existsSync(appPath)) {
        console.log('App not found for notarization:', appPath);
        return;
      }

      console.log(`Notarizing ${appPath}...`);

      await notarize({
        appPath,
        keychainProfile: 'ouijit-notarize',
      });

      console.log('Notarization complete!');
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin', 'linux']),
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
