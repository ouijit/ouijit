/**
 * Project interface representing a development project
 */
export interface Project {
  name: string;
  path: string;
  hasGit: boolean;
  hasClaude: boolean;
  lastModified: Date;
  description?: string;
  language?: string;
  iconDataUrl?: string;
}

/**
 * API interface exposed by the preload script
 */
export interface ElectronAPI {
  getProjects(): Promise<Project[]>;
  openProject(path: string): Promise<{ success: boolean }>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
