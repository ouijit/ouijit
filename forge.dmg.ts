// Helpers for the macOS DMG distributable. Lives outside forge.config.ts so the
// pure logic (signing-identity resolution, notarize-and-staple) can be unit tested
// without booting electron-forge.

import { notarize as electronNotarize } from '@electron/notarize';
import { execFileSync } from 'child_process';
import path from 'path';

export interface NotarizeCredentials {
  appleApiKeyId: string;
  appleApiIssuer: string;
  homeDir: string;
}

// Reads the Developer ID Application identity used to sign the DMG wrapper
// (the app inside is signed separately by osxSign). Honors SKIP_SIGN, then an
// explicit APPLE_SIGNING_IDENTITY env var, then falls back to the first
// Developer ID Application identity in the login keychain.
export function resolveSigningIdentity(
  env: NodeJS.ProcessEnv = process.env,
  runSecurity: (args: string[]) => string = (args) => execFileSync('security', args, { encoding: 'utf8' }),
): string | undefined {
  if (env.SKIP_SIGN) return undefined;
  if (env.APPLE_SIGNING_IDENTITY) return env.APPLE_SIGNING_IDENTITY;
  try {
    const output = runSecurity(['find-identity', '-v', '-p', 'codesigning']);
    const match = output.match(/"(Developer ID Application:[^"]+)"/);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

// Notarize a single DMG (or any signed artifact) and staple the ticket so the
// file carries proof of notarization offline. Apple requires both steps.
export async function notarizeAndStapleArtifact(
  artifactPath: string,
  options: {
    creds?: NotarizeCredentials;
    keychainProfile?: string;
    notarizeFn?: typeof electronNotarize;
    stapleFn?: (artifactPath: string) => void;
  } = {},
): Promise<void> {
  const notarizeFn = options.notarizeFn ?? electronNotarize;
  const stapleFn =
    options.stapleFn ??
    ((p: string) => {
      execFileSync('xcrun', ['stapler', 'staple', p], { stdio: 'inherit' });
    });

  if (options.creds) {
    const keyPath = path.join(options.creds.homeDir, 'private_keys', `AuthKey_${options.creds.appleApiKeyId}.p8`);
    await notarizeFn({
      appPath: artifactPath,
      appleApiKey: keyPath,
      appleApiKeyId: options.creds.appleApiKeyId,
      appleApiIssuer: options.creds.appleApiIssuer,
    });
  } else if (options.keychainProfile) {
    await notarizeFn({ appPath: artifactPath, keychainProfile: options.keychainProfile });
  } else {
    throw new Error('notarizeAndStapleArtifact requires either creds or keychainProfile');
  }

  stapleFn(artifactPath);
}

// Filter make artifacts down to DMGs and notarize+staple each. Honors
// SKIP_NOTARIZE so local builds without credentials still complete.
export async function notarizeAndStapleDMGs(
  artifacts: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    notarizeFn?: typeof electronNotarize;
    stapleFn?: (artifactPath: string) => void;
  } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (env.SKIP_NOTARIZE) return;

  const dmgs = artifacts.filter((a) => a.endsWith('.dmg'));
  if (dmgs.length === 0) return;

  const creds: NotarizeCredentials | undefined =
    env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER && env.HOME
      ? {
          appleApiKeyId: env.APPLE_API_KEY_ID,
          appleApiIssuer: env.APPLE_API_ISSUER,
          homeDir: env.HOME,
        }
      : undefined;
  const keychainProfile = creds ? undefined : 'ouijit-notarize';

  for (const dmg of dmgs) {
    await notarizeAndStapleArtifact(dmg, {
      creds,
      keychainProfile,
      notarizeFn: options.notarizeFn,
      stapleFn: options.stapleFn,
    });
  }
}
