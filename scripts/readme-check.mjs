#!/usr/bin/env node
/**
 * Checks that the README's mechanical claims still match the code, so drift
 * fails CI instead of waiting for someone to notice:
 *
 *   1. Every local image the README references exists on disk.
 *   2. Every screenshot the README references is a scene `npm run capture`
 *      produces, so a stale image is one command away from fresh.
 *   3. The "Supported harnesses" list matches the wrapper binaries the app
 *      installs (src/hookServer.ts).
 *   4. Every `ouijit` invocation in README code fences is a real CLI command.
 *
 * Usage: node scripts/readme-check.mjs   (requires dist-cli to be built)
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. Referenced local images exist.
const imageRefs = [
  ...[...readme.matchAll(/<(?:img|source)[^>]*(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]),
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]),
].filter((src) => !/^https?:/.test(src));

for (const ref of imageRefs) {
  if (!fs.existsSync(path.join(REPO_ROOT, ref))) fail(`README references missing file: ${ref}`);
}

// 2. Referenced screenshots are ones the capture driver can regenerate.
const captureSource = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture', 'run.mjs'), 'utf8');
const capturedFiles = new Set([...captureSource.matchAll(/file: '([^']+)'/g)].map((m) => m[1]));
const SCREENSHOT_DIR = 'website/public/assets/screenshots/';

for (const ref of imageRefs) {
  if (!ref.startsWith(SCREENSHOT_DIR)) continue;
  const file = ref.slice(SCREENSHOT_DIR.length);
  if (!capturedFiles.has(file)) {
    fail(
      `README references ${ref}, but scripts/capture/run.mjs has no scene producing ${file} — ` +
        `add a scene or drop the image, so every screenshot stays regenerable via \`npm run capture\`.`,
    );
  }
}

// 3. Harness list matches the wrappers the app installs.
const hookServer = fs.readFileSync(path.join(REPO_ROOT, 'src', 'hookServer.ts'), 'utf8');
const wrappers = [...hookServer.matchAll(/export const (\w+)_WRAPPER\b/g)].map((m) => m[1].toLowerCase());
const harnessSection = readme.match(/## Supported harnesses\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';

for (const wrapper of wrappers) {
  // Wrapper names are binary names (claude, codex, pi, opencode); the README
  // lists product names, so match case-insensitively on the link text.
  const pattern = { claude: /claude code/i, codex: /codex/i, pi: /\bpi\b/i, opencode: /opencode/i }[wrapper];
  if (!pattern) fail(`New wrapper ${wrapper.toUpperCase()}_WRAPPER in hookServer.ts — add it to this check and to the README harness list.`);
  else if (!pattern.test(harnessSection)) fail(`README "Supported harnesses" is missing ${wrapper} (the app installs a ${wrapper} wrapper).`);
}

// 4. Every `ouijit` command in README code fences exists in the CLI.
const cliPath = path.join(REPO_ROOT, 'dist-cli', 'ouijit.js');
if (!fs.existsSync(cliPath)) {
  fail('dist-cli/ouijit.js not built — run `npm run build:cli` first.');
} else {
  const fenced = [...readme.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  const invocations = [...fenced.matchAll(/^ouijit\s+(\S+)(?:\s+(\S+))?/gm)];
  const helpCache = new Map();
  const subcommandsOf = (group) => {
    if (!helpCache.has(group)) {
      let help = '';
      try {
        help = execFileSync('node', [cliPath, ...(group ? [group] : []), '--help'], { encoding: 'utf8' });
      } catch {}
      const commands = new Set(
        [...(help.match(/Commands:\n([\s\S]*?)(?:\n\n|$)/)?.[1] ?? '').matchAll(/^ {2}(\S+)/gm)].flatMap((m) =>
          m[1].split('|'),
        ),
      );
      helpCache.set(group, commands);
    }
    return helpCache.get(group);
  };

  for (const [, group, sub] of invocations) {
    if (!subcommandsOf(null).has(group)) {
      fail(`README example uses unknown command: ouijit ${group}`);
    } else if (sub && !sub.startsWith('-') && !sub.startsWith('$') && !subcommandsOf(group).has(sub)) {
      fail(`README example uses unknown subcommand: ouijit ${group} ${sub}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`README check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('README check passed.');
