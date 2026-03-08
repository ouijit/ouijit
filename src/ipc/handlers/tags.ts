import { typedHandle } from '../helpers';
import { getAllTags, getTaskTags, addTagToTask, removeTagFromTask, setTaskTags } from '../../db';

export function registerTagHandlers(): void {
  typedHandle('tags:get-all', () => getAllTags());
  typedHandle('tags:get-for-task', (projectPath, taskNumber) => getTaskTags(projectPath, taskNumber));
  typedHandle('tags:add-to-task', (projectPath, taskNumber, tagName) => addTagToTask(projectPath, taskNumber, tagName));
  typedHandle('tags:remove-from-task', (projectPath, taskNumber, tagName) => removeTagFromTask(projectPath, taskNumber, tagName));
  typedHandle('tags:set-task-tags', (projectPath, taskNumber, tagNames) => setTaskTags(projectPath, taskNumber, tagNames));
}
