import { typedHandle } from '../helpers';
import { getHooks, saveHook, deleteHook } from '../../db';

export function registerHookHandlers(): void {
  typedHandle('hooks:get', (projectPath) => getHooks(projectPath));
  typedHandle('hooks:save', (projectPath, hook) => saveHook(projectPath, hook));
  typedHandle('hooks:delete', (projectPath, hookType) => deleteHook(projectPath, hookType));
}
