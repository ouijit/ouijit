import { typedHandle } from '../helpers';
import {
  getHooks,
  saveHook,
  deleteHook,
  setKillExistingOnRun,
} from '../../projectSettings';

export function registerHookHandlers(): void {
  typedHandle('hooks:get', (projectPath) => getHooks(projectPath));
  typedHandle('hooks:save', (projectPath, hook) => saveHook(projectPath, hook));
  typedHandle('hooks:delete', (projectPath, hookType) => deleteHook(projectPath, hookType));
  typedHandle('settings:set-kill-existing-on-run', (projectPath, kill) => setKillExistingOnRun(projectPath, kill));
}
