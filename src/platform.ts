import { isTauri, invoke } from '@tauri-apps/api/core';
import { importFile } from './pdf';

export async function saveExport(bytes: Uint8Array, name: string, extension: string): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>('save_export', { bytes: Array.from(bytes), name, extension });
  }
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export async function importPresentation() {
  if (!isTauri()) throw new Error('Direct presentation conversion needs the Windows desktop app and LibreOffice. In PowerPoint, choose File → Export → PDF, then open that PDF here. All slide annotations and PDF exports work on the converted file.');
  const result = await invoke<{ name: string; bytes: number[] } | null>('convert_presentation');
  if (!result) return null;
  return importFile(new File([new Uint8Array(result.bytes)], result.name, { type: 'application/pdf' }));
}
