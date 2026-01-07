// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

// Define the Project interface for type safety
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

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  /**
   * Scans for projects in predefined directories
   * @returns Promise<Project[]> - Array of detected projects
   */
  getProjects: (): Promise<Project[]> => ipcRenderer.invoke('get-projects'),

  /**
   * Opens a project directory in the default file manager
   * @param path - The absolute path to the project directory
   * @returns Promise<{ success: boolean }> - Result of the operation
   */
  openProject: (path: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('open-project', path),
});

// Type declaration for the exposed API
declare global {
  interface Window {
    api: {
      getProjects: () => Promise<Project[]>;
      openProject: (path: string) => Promise<{ success: boolean }>;
    };
  }
}
