import { renderToStaticMarkup } from 'react-dom/server';
import { PDFDocument, degrees } from 'pdf-lib';
import { AnnotationObject, Background } from './Annotations';
import { fromBase64, type Lesson, type Page } from './model';
import { openPdf } from './pdf';

export interface ExportOptions { allPages: boolean; pageIndex: number; annotations: boolean }

export function pageSvg(page: Page, annotations: boolean, background: boolean) {
  return renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={page.width} height={page.height} viewBox={`0 0 ${page.width} ${page.height}`}>
    {background && <Background page={page} />}
    {annotations && page.annotations.map(a => <AnnotationObject key={a.id} annotation={a} />)}
  </svg>);
}

export async function svgCanvas(page: Page, annotations: boolean, background: boolean, scale = 2): Promise<HTMLCanvasElement> {
  const boundedScale = Math.min(scale, Math.sqrt(16000000 / (page.width * page.height)), 8192 / Math.max(page.width, page.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(page.width * boundedScale);
  canvas.height = Math.ceil(page.height * boundedScale);
  const url = URL.createObjectURL(new Blob([pageSvg(page, annotations, background)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas rendering is not available.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(async blob => {
    if (!blob) { reject(new Error('PNG encoding failed. Try exporting a smaller page.')); return; }
    try { resolve(new Uint8Array(await blob.arrayBuffer())); } catch (error) { reject(error); }
  }, 'image/png'));
}

export function overlayPlacement(rotation: number, x: number, y: number, width: number, height: number) {
  const angle = ((rotation % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(angle)) throw new Error('Unsupported PDF page rotation.');
  return {
    x: x + (angle === 90 || angle === 180 ? width : 0),
    y: y + (angle === 180 || angle === 270 ? height : 0),
    width: angle === 90 || angle === 270 ? height : width,
    height: angle === 90 || angle === 270 ? width : height,
    rotate: degrees(angle),
  };
}

export async function exportPdf(lesson: Lesson, options: ExportOptions): Promise<Uint8Array> {
  const indices = options.allPages ? lesson.pages.map((_, i) => i) : [options.pageIndex];
  const output = await PDFDocument.create();
  const source = lesson.source?.kind === 'pdf'
    ? await PDFDocument.load(fromBase64(lesson.source.data))
    : undefined;
  if (source && source.getPageCount() !== lesson.pages.length) throw new Error('Source page count does not match the lesson.');
  for (const index of indices) {
    const config = lesson.pages[index];
    if (!config) throw new Error('Invalid export page selection.');
    if (source) {
      const [copy] = await output.copyPages(source, [index]);
      output.addPage(copy);
      if (options.annotations && config.annotations.length) {
        const png = await output.embedPng(await canvasPng(await svgCanvas(config, true, false)));
        const crop = copy.getCropBox();
        copy.drawImage(png, overlayPlacement(copy.getRotation().angle, crop.x, crop.y, crop.width, crop.height));
      }
    } else {
      const page = output.addPage([config.width, config.height]);
      const composite = await compositePage(lesson, index, options.annotations);
      const png = await output.embedPng(await canvasPng(composite));
      page.drawImage(png, { x: 0, y: 0, width: config.width, height: config.height });
    }
  }
  output.setTitle(lesson.title);
  output.setCreator('Teacher Studio');
  return output.save();
}

export async function compositePage(lesson: Lesson, index: number, annotations: boolean): Promise<HTMLCanvasElement> {
  const config = lesson.pages[index], canvas = await svgCanvas(config, false, true), ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is not available.');
  if (lesson.source?.kind === 'pdf') {
    const doc = await openPdf(fromBase64(lesson.source.data));
    try {
      const page = await doc.getPage(index + 1);
      await page.render({ canvas, viewport: page.getViewport({ scale: canvas.width / config.width }) }).promise;
    } finally { await doc.loadingTask.destroy(); }
  } else if (lesson.source?.kind === 'image') {
    const image = await createImageBitmap(new Blob([fromBase64(lesson.source.data).slice().buffer]));
    try { ctx.drawImage(image, 0, 0, canvas.width, canvas.height); } finally { image.close(); }
  }
  if (annotations) {
    const overlay = await svgCanvas(config, true, false);
    ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}
