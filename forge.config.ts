import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { notarize } from '@electron/notarize';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// Copy a directory tree. Does NOT preserve unix permissions (fs.copyFileSync doesn't),
// so anything that needs +x must be chmod'd explicitly after copying.
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
    // ── Native module packaging ──────────────────────────────────────────
    //
    // Why this is needed:
    //   electron-forge's VitePlugin strips node_modules from the package
    //   (since Vite bundles JS). Native modules marked as rollup externals
    //   still need their real files on disk. This hook copies them in.
    //
    // Why we rebuild better-sqlite3 here:
    //   forge's rebuildConfig runs BEFORE this hook, when node_modules is
    //   still empty — so it's a no-op. We run electron-rebuild ourselves
    //   after copying, which is the only reliable way to get the right ABI.
    //
    // For cross-builds (e.g. Linux from macOS), set OUIJIT_CROSS_STAGING
    // to a directory with pre-built binaries for the target platform.
    afterCopy: [
      (buildPath, electronVersion, platform, _arch, callback) => {
        try {
          const staging = process.env.OUIJIT_CROSS_STAGING;
          const nodeModulesDest = path.join(buildPath, 'node_modules');

          // 1. Copy all native modules
          const modulesToCopy = ['node-pty', 'koffi', 'better-sqlite3', 'bindings', 'file-uri-to-path'];
          for (const mod of modulesToCopy) {
            const stagedSrc = staging ? path.join(staging, 'node_modules', mod) : null;
            const src = stagedSrc && fs.existsSync(stagedSrc)
              ? stagedSrc
              : path.join(__dirname, 'node_modules', mod);
            const dest = path.join(nodeModulesDest, mod);
            console.log(`Copying ${mod} from ${src}`);
            copyRecursive(src, dest);
          }

          // 2. Fix node-pty spawn-helper permissions (npm strips execute bits from tarballs)
          const spawnHelpers = [
            path.join(nodeModulesDest, 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
            path.join(nodeModulesDest, 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
          ];
          for (const helper of spawnHelpers) {
            if (fs.existsSync(helper)) {
              fs.chmodSync(helper, 0o755);
            }
          }

          // 3. Rebuild better-sqlite3 for Electron's ABI (skip for cross-builds
          //    which use pre-compiled staged binaries)
          if (!staging) {
            console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}`);
            execFileSync(
              path.join(__dirname, 'node_modules', '.bin', 'electron-rebuild'),
              ['-v', electronVersion, '-o', 'better-sqlite3', '--force', '-m', buildPath],
              { stdio: 'inherit' },
            );
          }

          // 4. Copy limactl binary
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

          // 5. Copy Lima guest agent binaries
          const stagedAgents = staging ? path.join(staging, 'share', 'lima') : null;
          const guestAgentSrc = stagedAgents && fs.existsSync(stagedAgents)
            ? stagedAgents
            : path.join(__dirname, 'resources', 'share', 'lima');
          if (fs.existsSync(guestAgentSrc)) {
            const shareDest = path.join(buildPath, '..', 'share', 'lima');
            copyRecursive(guestAgentSrc, shareDest);
            console.log(`Copied Lima guest agents from ${guestAgentSrc}`);
          }

          // 6. Copy app icon for Linux
          if (platform === 'linux') {
            const iconSrc = path.join(__dirname, 'src', 'assets', 'icons', 'icon.png');
            if (fs.existsSync(iconSrc)) {
              const iconDest = path.join(buildPath, 'icon.png');
              fs.copyFileSync(iconSrc, iconDest);
              console.log(`Copied icon.png for Linux`);
            }
          }

          // 7. Copy bundled CLI
          const cliSrc = path.join(__dirname, 'dist-cli', 'ouijit.js');
          if (fs.existsSync(cliSrc)) {
            const cliDest = path.join(buildPath, 'cli', 'ouijit.js');
            fs.mkdirSync(path.dirname(cliDest), { recursive: true });
            fs.copyFileSync(cliSrc, cliDest);
            console.log(`Copied CLI bundle`);
          }

          callback();
        } catch (err) {
          callback(err as Error);
        }
      },
    ],
  },
  // Rebuild better-sqlite3 for Electron's ABI during `npm start` (dev mode).
  // For packaging this is a no-op (Vite strips node_modules before it runs),
  // so afterCopy handles the packaging rebuild separately above.
  rebuildConfig: {
    force: true,
    onlyModules: ['better-sqlite3'],
  },
  hooks: {
    postMake: async (_config, makeResults) => {
      // Strip version from artifact filenames so GitHub release asset URLs
      // are stable across versions (enables /releases/latest/download/<name>)
      for (const result of makeResults) {
        result.artifacts = result.artifacts.map((artifact) => {
          const dir = path.dirname(artifact);
          const ext = path.extname(artifact);
          const base = path.basename(artifact, ext);
          // Match patterns like "ouijit-1.0.6-darwin-arm64" or "ouijit-darwin-arm64-1.0.6"
          const stripped = base.replace(/-\d+\.\d+\.\d+/, '');
          if (stripped === base) return artifact;
          const newPath = path.join(dir, stripped + ext);
          fs.renameSync(artifact, newPath);
          console.log(`Renamed ${path.basename(artifact)} → ${stripped + ext}`);
          return newPath;
        });
      }
      return makeResults;
    },
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

      if (process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) {
        // CI: App Store Connect API key (written to disk by workflow)
        const keyPath = path.join(
          process.env.HOME!,
          'private_keys',
          `AuthKey_${process.env.APPLE_API_KEY_ID}.p8`,
        );
        await notarize({
          appPath,
          appleApiKey: keyPath,
          appleApiKeyId: process.env.APPLE_API_KEY_ID,
          appleApiIssuer: process.env.APPLE_API_ISSUER,
        });
      } else {
        // Local: stored keychain profile
        await notarize({
          appPath,
          keychainProfile: 'ouijit-notarize',
        });
      }

      console.log('Notarization complete!');
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin', 'linux']),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'ouijit',
        name: 'ouijit',
      },
      draft: true,
      generateReleaseNotes: true,
    }),
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
