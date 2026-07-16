import { invoke } from '@tauri-apps/api/core';
import { open, save, type DialogFilter } from '@tauri-apps/plugin-dialog';

export type ExportWriteResult = 'saved' | 'downloaded' | 'cancelled';

interface FileExport {
  name: string;
  blob: Blob;
}

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
