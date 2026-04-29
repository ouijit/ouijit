import { typedHandle } from '../helpers';
import { refreshHealth } from '../../healthCheck';

export function registerHealthHandlers(): void {
  typedHandle('health:check', () => refreshHealth());
}
