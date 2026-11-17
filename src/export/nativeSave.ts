import { invoke } from '@tauri-apps/api/core';
import { open, save, type DialogFilter } from '@tauri-apps/plugin-dialog';
import { isProtectedProjectPath } from '../project/projectCopy';

export type ExportWriteResult = 'saved' | 'downloaded' | 'cancelled';

interface FileExport {
  name: string;
  blob: Blob;
}

export function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function saveProjectFile(name: string, content: string, existingPath?: string | null, protectedPaths: string[] = []): Promise<string | null> {
  if (!isDesktopRuntime()) {
    browserDownload(new Blob([content], { type: 'application/json' }), name);
    return `Browser download: ${name}`;
  }
  const path = existingPath ?? await save({ title: 'Save project', defaultPath: name, filters: [{ name: 'Pixel Rig Studio project', extensions: ['pixelrig.json', 'json'] }] });
  if (!path) return null;
  if (isProtectedProjectPath(path, protectedPaths)) throw new Error('This is the original project path. Choose a different filename or folder to save the copy.');
  await invoke('write_export_file', { path, data: await bytes(new Blob([content], { type: 'application/json' })) });
  return path;
}

export async function openProjectFileDialog(): Promise<{ path: string; content: string } | null> {
  if (!isDesktopRuntime()) return null;
  const path = await open({ title: 'Open project', multiple: false, directory: false, filters: [{ name: 'Pixel Rig Studio project', extensions: ['pixelrig.json', 'json'] }] });
  if (!path || Array.isArray(path)) return null;
  const content = await invoke<string>('read_project_file', { path });
  return { path, content };
}

function browserDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function bytes(blob: Blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

export async function saveExportFile(file: FileExport, filter: DialogFilter): Promise<ExportWriteResult> {
  if (!isDesktopRuntime()) {
    browserDownload(file.blob, file.name);
    return 'downloaded';
  }
  const path = await save({ title: 'Save export', defaultPath: file.name, filters: [filter] });
  if (!path) return 'cancelled';
  await invoke('write_export_file', { path, data: await bytes(file.blob) });
  return 'saved';
}

export async function saveExportFrames(files: FileExport[]): Promise<ExportWriteResult> {
  if (!isDesktopRuntime()) {
    files.forEach((file) => browserDownload(file.blob, file.name));
    return 'downloaded';
  }
  const directory = await open({ title: 'Choose export folder', directory: true, multiple: false });
  if (!directory) return 'cancelled';
  for (const file of files) {
    await invoke('write_export_file_in_directory', { directory, name: file.name, data: await bytes(file.blob) });
  }
  return 'saved';
}
