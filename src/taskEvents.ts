import { EventEmitter } from 'node:events';
import type { TaskStatus } from './types';

export interface TaskStatusChange {
  projectPath: string;
  taskNumber: number;
  from: TaskStatus;
  to: TaskStatus;
}

/** Fires on every status write, from whichever process or client made it. */
export const taskEvents = new EventEmitter<{ status: [TaskStatusChange] }>();
