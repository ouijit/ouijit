import { typedHandle } from '../helpers';
import { getScripts, saveScript, deleteScript, reorderScripts } from '../../db';

export function registerScriptHandlers(): void {
  typedHandle('scripts:get-all', (projectPath) => getScripts(projectPath));
  typedHandle('scripts:save', (projectPath, script) => saveScript(projectPath, script));
  typedHandle('scripts:delete', (projectPath, scriptId) => deleteScript(projectPath, scriptId));
  typedHandle('scripts:reorder', (projectPath, scriptIds) => reorderScripts(projectPath, scriptIds));
}
