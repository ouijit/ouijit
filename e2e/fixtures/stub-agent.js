#!/usr/bin/env node
// A stand-in for an agent CLI, run by the e2e suite as `claude` or `codex`.
// It takes the status hooks Ouijit's wrapper injects (claude's --settings JSON,
// codex's -c hooks.<Event> overrides) and runs them as the real agent would.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SHIFT_ENTER = ['\x1b[13;2u', '\x1b\r'];
const hooks = { UserPromptSubmit: [], Stop: [] };
const prompt = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--settings') {
    const settings = JSON.parse(args[++i]);
    for (const event of Object.keys(hooks)) {
      for (const matcher of settings.hooks?.[event] ?? []) {
        for (const hook of matcher.hooks) hooks[event].push(hook.command);
      }
    }
  } else if (arg === '-c') {
    const match = /^hooks\.(\w+)=.*command="([^"]+)"/.exec(args[++i]);
    if (match && hooks[match[1]]) hooks[match[1]].push(match[2]);
  } else if (arg === '--append-system-prompt-file') {
    i++;
  } else if (!arg.startsWith('-')) {
    prompt.push(arg);
  }
}

function report(event) {
  return Promise.all(
    hooks[event].map((command) => new Promise((resolve) => execFile('/bin/sh', ['-c', command], resolve))),
  );
}

const write = (text) => process.stdout.write(text.replace(/\n/g, '\r\n'));

let busy = false;
async function turn(lines) {
  busy = true;
  await report('UserPromptSubmit');
  fs.appendFileSync(path.join(process.cwd(), 'stub-agent.md'), `${lines.join('\n')}\n`);
  await new Promise((r) => setTimeout(r, 1_500));
  write(`\nheard ${lines.length} line(s): ${lines.join(' | ')}\n> `);
  await report('Stop');
  busy = false;
}

function exit() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  write('\nSTUB_AGENT_EXITED\n');
  process.exit(0);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
write('STUB_AGENT_READY\n> ');

let lines = [''];
process.stdin.on('data', (data) => {
  let rest = data;
  while (rest.length > 0) {
    const newline = SHIFT_ENTER.find((seq) => rest.startsWith(seq));
    if (newline) {
      lines.push('');
      write('\n  ');
      rest = rest.slice(newline.length);
      continue;
    }
    const key = rest[0];
    rest = rest.slice(1);
    if (key === '\x03' || key === '\x04') return exit();
    if (key === '\r') {
      const submitted = lines;
      lines = [''];
      if (submitted.join('') === '/exit') return exit();
      if (!busy) void turn(submitted);
    } else if (key === '\x7f') {
      lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1);
      write('\b \b');
    } else if (key >= ' ') {
      lines[lines.length - 1] += key;
      write(key);
    }
  }
});

if (prompt.length > 0) void turn([prompt.join(' ')]);
