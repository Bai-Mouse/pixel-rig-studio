import type { SerializableProject } from '../export/projectSerializer';

export interface ProjectCheckpoint {
  snapshot: SerializableProject;
  needsFirstSave?: boolean;
}

export function hasUnsavedProjectChanges(checkpoint: ProjectCheckpoint | null, current: SerializableProject): boolean {
  if (!checkpoint) return false;
  if (checkpoint.needsFirstSave) return true;
  return (Object.keys(checkpoint.snapshot) as (keyof SerializableProject)[]).some((key) => {
    const saved = checkpoint.snapshot[key];
    const value = current[key];
    return saved !== value && JSON.stringify(saved) !== JSON.stringify(value);
  });
}

export function canCloseProject(choice: 'discard' | 'save' | 'cancel', saved: boolean, stillDirty: boolean): boolean {
  return choice === 'discard' || (choice === 'save' && saved && !stillDirty);
}
