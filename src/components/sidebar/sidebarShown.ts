import { useAppStore } from '../../stores/appStore';
import { useUIStore } from '../../stores/uiStore';

/** Until the user picks, open once there is a project to list: a first launch is about adding one. */
function resolve(choice: boolean | null, hasProjects: boolean): boolean {
  return choice ?? hasProjects;
}

function anyProjects(s: ReturnType<typeof useAppStore.getState>): boolean {
  return s.projects.length > 0 || s.cloneJobs.length > 0;
}

export function useSidebarShown(): boolean {
  const choice = useUIStore((s) => s.sidebarShown);
  const hasProjects = useAppStore(anyProjects);
  return resolve(choice, hasProjects);
}

export function sidebarShownNow(): boolean {
  return resolve(useUIStore.getState().sidebarShown, anyProjects(useAppStore.getState()));
}
