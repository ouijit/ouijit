import { typedHandle } from '../helpers';
import { refreshAnalysis, getDiffSignals } from '../../analysis/service';

export function registerAnalysisHandlers(): void {
  typedHandle('analysis:refresh', (projectPath) => refreshAnalysis(projectPath));
  typedHandle('analysis:diff-signals', (projectPath, paths) => getDiffSignals(projectPath, paths));
}
