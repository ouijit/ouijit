import { typedHandle } from '../helpers';
import { refreshAnalysis, getDiffSignals, getAnalysisOverview } from '../../analysis/service';

export function registerAnalysisHandlers(): void {
  typedHandle('analysis:refresh', (projectPath, force) => refreshAnalysis(projectPath, force));
  typedHandle('analysis:diff-signals', (projectPath, paths) => getDiffSignals(projectPath, paths));
  typedHandle('analysis:overview', (projectPath) => getAnalysisOverview(projectPath));
}
