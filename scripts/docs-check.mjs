#!/usr/bin/env node
/**
 * Checks that the README's and the website docs' mechanical claims still match
 * the code, so drift fails CI instead of waiting for someone to notice:
 *
 *   1. Every local image the README and the docs pages reference exists on
 *      disk.
 *   2. Every screenshot they reference is a scene `npm run capture` produces,
 *      so a stale image is one command away from fresh.
 *   3. The "Supported harnesses" list matches the wrapper binaries the app
 *      installs (src/hookServer.ts).
 *   4. Every `ouijit` invocation in README and docs-page code fences is a real
 *      CLI command.
 *   5. Every CLI command is mentioned in the docs pages, so a new command
 *      cannot ship undocumented.
 *
 * Usage: node scripts/docs-check.mjs   (requires dist-cli to be built)
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
const DOCS_DIR = 'website/src/pages/docs';
const docsPages = fs
  .readdirSync(path.join(REPO_ROOT, DOCS_DIR))
  .filter((f) => f.endsWith('.astro'))
  .sort()
  .map((f) => ({ name: `${DOCS_DIR}/${f}`, text: fs.readFileSync(path.join(REPO_ROOT, DOCS_DIR, f), 'utf8') }));

const failures = [];
const fail = (msg) => failures.push(msg);

// 1. Referenced local images exist. README paths are repo-relative; docs-page
//    paths are site-absolute and resolve under website/public.
const imageRefs = [
  ...[...readme.matchAll(/<(?:img|source)[^>]*(?:src|srcset)="([^"]+)"/g)].map((m) => [m[1], 'README']),
  ...[...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => [m[1], 'README']),
  ...docsPages.flatMap((page) =>
    [...page.text.matchAll(/<img[^>]*src="(\/[^"]+)"/g)].map((m) => [`website/public${m[1]}`, page.name]),
  ),
].filter(([src]) => !/^https?:/.test(src));

for (const [ref, source] of imageRefs) {
  if (!fs.existsSync(path.join(REPO_ROOT, ref))) fail(`${source} references missing file: ${ref}`);
}

// 2. Referenced screenshots are ones the capture driver can regenerate.
const captureSource = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'capture', 'run.mjs'), 'utf8');
const capturedFiles = new Set([...captureSource.matchAll(/file: '([^']+)'/g)].map((m) => m[1]));
const SCREENSHOT_DIR = 'website/public/assets/screenshots/';

for (const [ref, source] of imageRefs) {
  if (!ref.startsWith(SCREENSHOT_DIR)) continue;
  const file = ref.slice(SCREENSHOT_DIR.length);
  if (!capturedFiles.has(file)) {
    fail(
      `${source} references ${ref}, but scripts/capture/run.mjs has no scene producing ${file} — ` +
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

// 4. Every `ouijit` command in README and docs-page code fences exists in the
//    CLI, and (5) every CLI command appears in the docs pages.
const cliPath = path.join(REPO_ROOT, 'dist-cli', 'ouijit.js');
if (!fs.existsSync(cliPath)) {
  fail('dist-cli/ouijit.js not built — run `npm run build:cli` first.');
} else {
  const decodeEntities = (s) => s.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  const fencesOf = (astro) =>
    [...astro.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map((m) =>
      decodeEntities(m[1].replace(/^\{`/, '').replace(/`\}$/, '')),
    );

  const helpCache = new Map();
  // Commander prints subcommands as "  name|alias <args>  description"; each
  // entry here is the alias set for one command.
  const commandsOf = (groupPath) => {
    const key = groupPath.join(' ');
    if (!helpCache.has(key)) {
      let help = '';
      try {
        help = execFileSync('node', [cliPath, ...groupPath, '--help'], { encoding: 'utf8' });
      } catch {}
      const aliasSets = [...(help.match(/Commands:\n([\s\S]*?)(?:\n\n|$)/)?.[1] ?? '').matchAll(/^ {2}(\S+)/gm)]
        .map((m) => m[1].split('|'))
        .filter((names) => !names.includes('help'));
      helpCache.set(key, aliasSets);
    }
    return helpCache.get(key);
  };
  const isCommand = (groupPath, name) => commandsOf(groupPath).some((names) => names.includes(name));

  for (const [source, fences] of [
    ['README', [...readme.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)].map((m) => m[1])],
    ...docsPages.map((page) => [page.name, fencesOf(page.text)]),
  ]) {
    const invocations = [...fences.join('\n').matchAll(/^ouijit\s+(\S+)(?:\s+(\S+))?/gm)];
    for (const [, group, sub] of invocations) {
      if (!isCommand([], group)) {
        fail(`${source} example uses unknown command: ouijit ${group}`);
      } else if (sub && !sub.startsWith('-') && !sub.startsWith('$') && !isCommand([group], sub)) {
        fail(`${source} example uses unknown subcommand: ouijit ${group} ${sub}`);
      }
    }
  }

  // 5. Coverage: walk the command tree; every leaf must be mentioned in some
  //    docs page under one of its names.
  const allDocsText = docsPages.map((p) => p.text).join('\n');
  const requireDocumented = (groupPath, aliasSets) => {
    for (const names of aliasSets) {
      const children = commandsOf([...groupPath, names[0]]);
      if (children.length > 0) {
        requireDocumented([...groupPath, names[0]], children);
        continue;
      }
      const documented = names.some((name) =>
        new RegExp(`ouijit\\s+${[...groupPath, name].join('\\s+')}\\b`).test(allDocsText),
      );
      if (!documented) {
        fail(`CLI command \`ouijit ${[...groupPath, names[0]].join(' ')}\` is not documented in ${DOCS_DIR}/.`);
      }
    }
  };
  requireDocumented([], commandsOf([]));
}

if (failures.length > 0) {
  console.error(`Docs check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Docs check passed.');
