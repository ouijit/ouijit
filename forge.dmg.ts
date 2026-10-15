// Helpers for the macOS DMG distributable. Lives outside forge.config.ts so the
// pure logic (signing-identity resolution, notarization) can be unit tested
// without booting electron-forge.

import { notarize as electronNotarize } from '@electron/notarize';
import { execFileSync } from 'child_process';
import path from 'path';

type NotarizeOptions = Parameters<typeof electronNotarize>[0];

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

// CI writes an App Store Connect API key to disk; local builds use a stored
// keychain profile.
function notarizeOptions(appPath: string, env: NodeJS.ProcessEnv): NotarizeOptions {
  if (env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER && env.HOME) {
    return {
      appPath,
      appleApiKey: path.join(env.HOME, 'private_keys', `AuthKey_${env.APPLE_API_KEY_ID}.p8`),
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER,
    };
  }
  return { appPath, keychainProfile: 'ouijit-notarize' };
}

// @electron/notarize staples after notarizing, and reports a failed staple only
// through this message. Stapling fetches the ticket from Apple's CloudKit, so it
// can fail on the network after notarization succeeded; the artifact is then
// still notarized and Gatekeeper finds the ticket online. The release workflow
// staples the DMG again before verifying it.
const STAPLE_FAILURE = 'Failed to staple';

export async function notarizeAllowingUnstapled(
  appPath: string,
  options: { env?: NodeJS.ProcessEnv; notarizeFn?: typeof electronNotarize } = {},
): Promise<void> {
  const notarizeFn = options.notarizeFn ?? electronNotarize;
  try {
    await notarizeFn(notarizeOptions(appPath, options.env ?? process.env));
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith(STAPLE_FAILURE)) throw err;
    console.warn(`Notarized but not stapled: ${appPath}\n${err.message}`);
  }
}

// Apple requires the distribution artifact itself to be notarized, not just the
// app inside it, otherwise Gatekeeper warns on first open.
export async function notarizeDMGs(
  artifacts: readonly string[],
  options: { env?: NodeJS.ProcessEnv; notarizeFn?: typeof electronNotarize } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  if (env.SKIP_NOTARIZE) return;

  for (const dmg of artifacts.filter((a) => a.endsWith('.dmg'))) {
    await notarizeAllowingUnstapled(dmg, { env, notarizeFn: options.notarizeFn });
  }
}
