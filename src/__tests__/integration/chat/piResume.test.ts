import { test, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { piSessionFile } from '../../../agents';

test('a Pi session resumes from its file wherever it was started, set to run in the folder it resumes in', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ouijit-pi-sessions-'));
  const id = '9746e879-b301-45c9-bb23-3ff0910276d6';
  const folder = path.join(root, '--old-folder--');
  fs.mkdirSync(folder);
  const file = path.join(folder, `2026-11-18T02-41-21-608Z_${id}.jsonl`);
  const rest = '{"type":"model_change","id":"674bebb4","parentId":null}\n';
  fs.writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id, cwd: '/old/folder' }) + '\n' + rest);
  fs.writeFileSync(path.join(folder, '2026-11-18T03-00-00-000Z_another.jsonl'), '{"type":"session","id":"another"}\n');

  expect(await piSessionFile(id, '/new/folder', root)).toBe(file);
  const [header, ...after] = fs.readFileSync(file, 'utf8').split('\n');
  expect(JSON.parse(header)).toEqual({ type: 'session', version: 3, id, cwd: '/new/folder' });
  expect(after.join('\n')).toBe(rest);

  // Unknown, it starts as Pi would by id.
  expect(await piSessionFile('missing', '/new/folder', root)).toBeNull();
  expect(await piSessionFile(id, '/new/folder', path.join(root, 'nowhere'))).toBeNull();
});
