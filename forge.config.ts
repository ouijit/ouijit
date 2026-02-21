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
    // Copy native modules BEFORE signing (afterCopy runs before osxSign).
    // For cross-builds (e.g. Linux from macOS), set OUIJIT_CROSS_STAGING to a directory
    // containing pre-built binaries: node_modules/node-pty/, bin/limactl, share/lima/
    afterCopy: [
      (buildPath, _electronVersion, platform, _arch, callback) => {
        const staging = process.env.OUIJIT_CROSS_STAGING;
        const nodeModulesDest = path.join(buildPath, 'node_modules');

        const modulesToCopy = ['node-pty', 'koffi', 'better-sqlite3'];
        for (const mod of modulesToCopy) {
          // For cross-builds, use staged native modules when available
          const stagedSrc = staging ? path.join(staging, 'node_modules', mod) : null;
          const src = stagedSrc && fs.existsSync(stagedSrc)
            ? stagedSrc
            : path.join(__dirname, 'node_modules', mod);
          const dest = path.join(nodeModulesDest, mod);
          console.log(`Copying ${mod} from ${src}`);
          copyRecursive(src, dest);
        }

        // Copy limactl binary — prefer staged version for cross-builds
        const stagedLimactl = staging ? path.join(staging, 'bin', 'limactl') : null;
        const limactlSrc = stagedLimactl && fs.existsSync(stagedLimactl)
          ? stagedLimactl
          : path.join(__dirname, 'resources', 'bin', 'limactl');
        if (fs.existsSync(limactlSrc)) {
          const binDest = path.join(buildPath, '..', 'bin');
          fs.mkdirSync(binDest, { recursive: true });
          fs.copyFileSync(limactlSrc, path.join(binDest, 'limactl'));
          fs.chmodSync(path.join(binDest, 'limactl'), 0o755);
          console.log(`Copied limactl from ${limactlSrc}`);
        }

        // Copy Lima guest agent binaries — prefer staged version for cross-builds
        const stagedAgents = staging ? path.join(staging, 'share', 'lima') : null;
        const guestAgentSrc = stagedAgents && fs.existsSync(stagedAgents)
          ? stagedAgents
          : path.join(__dirname, 'resources', 'share', 'lima');
        if (fs.existsSync(guestAgentSrc)) {
          const shareDest = path.join(buildPath, '..', 'share', 'lima');
          copyRecursive(guestAgentSrc, shareDest);
          console.log(`Copied Lima guest agents from ${guestAgentSrc}`);
        }

        // Copy app icon for Linux (used by BrowserWindow.icon at runtime)
        if (platform === 'linux') {
          const iconSrc = path.join(__dirname, 'src', 'assets', 'icons', 'icon.png');
          if (fs.existsSync(iconSrc)) {
            const iconDest = path.join(buildPath, 'icon.png');
            fs.copyFileSync(iconSrc, iconDest);
            console.log(`Copied icon.png for Linux`);
          }
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
