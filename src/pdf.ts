import * as pdfjs from 'pdfjs-dist';
import { fromBase64, MAX_FILE_BYTES, MAX_PROJECT_BYTES, newBoard, deserializeProject, toBase64, lessonSchema, type Lesson } from './model';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf-assets/pdf.worker.min.mjs', document.baseURI).href;
export { pdfjs };

export interface DocumentAdapter {
  kind: 'pdf' | 'image';
  extensions: readonly string[];
  inspect(bytes: Uint8Array): Promise<{ width: number; height: number }[]>;
}

export const documentAdapters: readonly DocumentAdapter[] = [
  {
    kind: 'pdf', extensions: ['pdf'],
    async inspect(bytes) {
      const doc = await openPdf(bytes);
      try {
        if (doc.numPages > 2000) throw new Error('Documents are limited to 2,000 pages.');
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i), viewport = page.getViewport({ scale: 1 });
          pages.push({ width: viewport.width, height: viewport.height }); page.cleanup();
        }
        return pages;
      } finally { await doc.loadingTask.destroy(); }
    },
  },
  {
    kind: 'image', extensions: ['png', 'jpg', 'jpeg', 'webp'],
    async inspect(bytes) {
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
      if (!png && !jpeg && !webp) throw new Error('The image contents are not PNG, JPEG or WebP.');
      const image = await decodeImage(bytes);
      try {
        if (image.width > 16000 || image.height > 16000 || image.width * image.height > 40000000)
          throw new Error('Image is too large. Resize to at most 40 megapixels and 16,000 pixels per side.');
        return [{ width: image.width, height: image.height }];
      } finally { image.close(); }
    },
  },
];

export async function openPdf(data: Uint8Array) {
  const assets = new URL('pdf-assets/', document.baseURI).href;
  const task = pdfjs.getDocument({
    data: data.slice(), useSystemFonts: true,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PDF loading timed out. Try opening a smaller PDF or exporting a fresh copy.')), 60000);
      }),
    ]);
  } catch (error) {
    await task.destroy();
    throw error;
  } finally { clearTimeout(timer); }
}

export async function importFile(file: File): Promise<Lesson> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (file.size === 0) throw new Error('This file is empty.');
  if (extension === 'teacherstudio') {
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Projects must be smaller than 150 MB.');
    const lesson = deserializeProject(await file.text());
    await validateSource(lesson);
    return { ...lesson, id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('Documents must be smaller than 75 MB.');
  const adapter = documentAdapters.find(adapter => adapter.extensions.includes(extension ?? ''));
  if (!adapter)
    throw new Error('Unsupported file. Open PDF, PNG, JPEG, WebP or .teacherstudio. For PowerPoint, use Import presentation or export to PDF in PowerPoint.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lesson = newBoard();
  lesson.title = file.name.replace(/\.[^.]+$/, '');
  lesson.kind = 'document';
  lesson.source = { name: file.name, kind: adapter.kind, data: toBase64(bytes) };
  lesson.pages = (await adapter.inspect(bytes)).map(size => ({ ...size, id: crypto.randomUUID(), background: '#ffffff', pattern: 'plain', annotations: [] }));
  return lessonSchema.parse(lesson);
}

export async function decodeImage(bytes: Uint8Array) {
  return createImageBitmap(new Blob([bytes.slice().buffer]));
}

export async function validateSource(lesson: Lesson) {
  if (!lesson.source) return;
  const bytes = fromBase64(lesson.source.data);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Bundled source exceeds 75 MB.');
  const adapter = documentAdapters.find(adapter => adapter.kind === lesson.source!.kind);
  if (!adapter) throw new Error('Unsupported source format.');
  const pages = await adapter.inspect(bytes);
  if (pages.length !== lesson.pages.length) throw new Error('Bundled source page count does not match the project.');
  for (let i = 0; i < pages.length; i++) {
    if (Math.abs(pages[i].width - lesson.pages[i].width) > 0.1 || Math.abs(pages[i].height - lesson.pages[i].height) > 0.1)
      throw new Error(`Bundled source dimensions do not match page ${i + 1}.`);
  }
}
