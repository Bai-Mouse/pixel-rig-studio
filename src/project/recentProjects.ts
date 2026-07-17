import type { ProjectFile } from '../export/projectSerializer';

export interface RecentProject {
  id: string;
  name: string;
  path?: string;
  savedAt: string;
  project: ProjectFile;
}

const storageKey = 'pixel-rig-studio:recent-projects';

export function readRecentProjects(): RecentProject[] {
  try {
    const saved = window.localStorage.getItem(storageKey);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentProject => Boolean(item && typeof item === 'object' && 'id' in item && 'name' in item && 'project' in item)).slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberProject(project: ProjectFile, name: string, path?: string): RecentProject[] {
  const entry: RecentProject = { id: crypto.randomUUID(), name, path, savedAt: project.savedAt, project };
  const recent = [entry, ...readRecentProjects().filter((item) => (path ? item.path !== path : item.name !== name))].slice(0, 5);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(recent));
  } catch {
    // Large embedded PNG projects can exceed the browser's local-storage quota.
  }
  return recent;
}
