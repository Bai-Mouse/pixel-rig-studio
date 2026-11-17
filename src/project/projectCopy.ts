import type { SerializableProject } from '../export/projectSerializer';

export function makeProjectCopy(project: SerializableProject, name: string) {
  return { project: structuredClone(project), name: `${name} - Copy`, path: null };
}

export function isProtectedProjectPath(path: string, protectedPaths: string[]): boolean {
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.replace(/\\/g, '/').toLowerCase().split('/')) {
      if (part === '.') continue;
      if (part === '..') parts.pop(); else parts.push(part);
    }
    return parts.join('/');
  };
  return protectedPaths.some((original) => normalize(original) === normalize(path));
}
