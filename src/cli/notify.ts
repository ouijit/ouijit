/**
 * Sentinel file for notifying the Electron app of CLI changes.
 * After any write operation, the CLI writes a JSON payload to <userData>/cli-notify.json.
 * The Electron app watches this file and re-fetches data.
 */

import * as fs from 'node:fs';
import { getUserDataPath } from '../paths';
import * as path from 'node:path';

export function notify(project: string, action: string): void {
  const payload = { project, action, ts: Date.now() };
  const filePath = path.join(getUserDataPath(), 'cli-notify.json');
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
}
