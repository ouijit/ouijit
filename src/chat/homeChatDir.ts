import * as path from 'node:path';
import { getUserDataPath } from '../paths';

export function homeChatDir(): string {
  return path.join(getUserDataPath(), 'chat');
}
