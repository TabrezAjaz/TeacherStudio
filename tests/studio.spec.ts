import { test, expect, type Page as BrowserPage } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { newBoard, serializeProject, toBase64 } from '../src/model';

async function fixture() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [i, size] of [[600, 800], [800, 600], [600, 800], [600, 800], [600, 800]].entries()) {
    const page = pdf.addPage([size[0], size[1]]);
    if (i === 2) page.setRotation(degrees(90));
    if (i === 3) { page.setRotation(degrees(180)); page.setCropBox(20, 30, 550, 720); }
    if (i === 4) page.setRotation(degrees(270));
    page.drawText(`Original classroom content - page ${i + 1}`, { x: 60, y: 90, size: 18, font });
    page.drawRectangle({ x: 70, y: 150, width: 80, height: 80, color: rgb(0, 0, 1) });
  }
  return pdf.save();
}

async function importBytes(page: BrowserPage, name: string, bytes: Uint8Array) {
  await page.getByLabel('Import document or project').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await expect(page.getByTestId('annotation-canvas')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Saved locally', { exact: false })).toBeVisible();
}

async function download(page: BrowserPage, format: string, current = false, annotations = true) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption(format);
  if (current && format === 'pdf') await page.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('current');
  if (!annotations && format !== 'teacherstudio') await page.getByLabel('Include annotations').uncheck();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export a copy', exact: true }).click();
  const result = await event, path = await result.path();
  expect(path).not.toBeNull();
  return new Uint8Array(await readFile(path!));
}

async function visiblePaperPixel(page: BrowserPage, x: number, y: number, width: number, height: number) {
  const screenshot = await page.locator('.paper').screenshot({ scale: 'css' });
  return page.evaluate(async ({ bytes, x, y, width, height }) => {
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(x / width * image.width), Math.floor(y / height * image.height), 1, 1).data);
    } finally { image.close(); }
  }, { bytes: Array.from(screenshot), x, y, width, height });
}

test('PDF content and ink are visibly composited in the workspace, not only in exports', async ({ page }) => {
  await page.goto('/');
  await importBytes(page, 'visible-content.pdf', await fixture());
  const blue = [0, 0, 255, 255], ink = [232, 121, 58, 255];
  const assertSourceVisible = async (height: number) => {
    await expect.poll(() => visiblePaperPixel(page, 110, height - 190, 600, height)).toEqual(blue);
  };
  await assertSourceVisible(800);
  await page.getByRole('button', { name: 'Ink #e8793a', exact: true }).click();
  await page.getByRole('button', { name: 'Straight line', exact: true }).click();
  const canvas = page.getByTestId('annotation-canvas'), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 95 / 600 * box.width, box.y + 610 / 800 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + 145 / 600 * box.width, box.y + 610 / 800 * box.height, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => visiblePaperPixel(page, 120, 610, 600, 800)).toEqual(ink);
  await expect.poll(() => visiblePaperPixel(page, 110, 590, 600, 800)).toEqual(blue);

  for (const name of ['Highlighter (M)', 'Select / PDF text (V)', 'Pen (P)']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(() => visiblePaperPixel(page, 110, 590, 600, 800)).toEqual(blue);
  }
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => visiblePaperPixel(page, 110, 590, 600, 800)).toEqual(blue);
  await expect.poll(() => visiblePaperPixel(page, 120, 610, 600, 800)).toEqual(ink);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => visiblePaperPixel(page, 110, 410, 800, 600)).toEqual(blue);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect.poll(() => visiblePaperPixel(page, 120, 610, 600, 800)).toEqual(ink);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(() => visiblePaperPixel(page, 110, 590, 600, 800)).toEqual(blue);
  await page.reload();
  await page.getByRole('button', { name: 'Open visible-content', exact: true }).click();
  await expect.poll(() => visiblePaperPixel(page, 110, 590, 600, 800)).toEqual(blue);
  await expect.poll(() => visiblePaperPixel(page, 120, 610, 600, 800)).toEqual(ink);
});

test('real handwriting, text, history, library persistence and portable whiteboard exports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'New whiteboard', exact: false }).click();
  const canvas = page.getByTestId('annotation-canvas'), rect = await canvas.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + 100, rect!.y + 90); await page.mouse.down();
  await page.mouse.move(rect!.x + 180, rect!.y + 130, { steps: 20 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Text box (T)', exact: true }).click();
  await canvas.click({ position: { x: 120, y: 190 } });
  await page.getByLabel('Your text').fill('A real editable lesson');
  await page.getByRole('button', { name: 'Place text' }).click();
  await expect(canvas.locator('text')).toContainText('A real editable lesson');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(canvas.locator('text')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo (Ctrl+Y)', exact: true }).click();
  await expect(canvas.locator('text')).toContainText('A real editable lesson');
  await page.getByLabel('Paper pattern').selectOption('grid');
  const project = await download(page, 'teacherstudio');
  const json = JSON.parse(new TextDecoder().decode(project));
  expect(json.pages[0].annotations).toHaveLength(2);
  expect(json.pages[0].pattern).toBe('grid');
  const pdf = await PDFDocument.load(await download(page, 'pdf'));
  expect(pdf.getPages().map(p => p.getSize())).toEqual([{ width: 1600, height: 1000 }]);
  const png = await download(page, 'png');
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new DataView(png.buffer).getUint32(16)).toBe(3200);
  await page.reload();
  await page.getByRole('button', { name: 'Open Untitled whiteboard', exact: true }).click();
  await expect(page.getByTestId('annotation-canvas').locator('text')).toContainText('A real editable lesson');
  await page.getByRole('button', { name: 'Back to lessons' }).click();
  await importBytes(page, 'backup.teacherstudio', project);
  await expect(page.getByTestId('annotation-canvas').locator('text')).toContainText('A real editable lesson');
  expect(errors).toEqual([]);
});

test('multi-page PDF keeps original text, mixed dimensions, all rotations, crop boxes and exact overlay alignment', async ({ page }, testInfo) => {
  await page.goto('/');
  const original = await fixture();
  await importBytes(page, 'teaching.pdf', original);
  await expect(page.getByText('Page 1 of 5', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select / PDF text (V)', exact: true }).click();
  const textLayer = page.locator('.paper .textLayer');
  await expect(textLayer).toContainText('Original classroom content - page 1');
  const textBounds = (await textLayer.locator('span').first().boundingBox())!;
  await page.mouse.move(textBounds.x, textBounds.y + textBounds.height / 2);
  await page.mouse.down(); await page.mouse.move(textBounds.x + textBounds.width, textBounds.y + textBounds.height / 2, { steps: 10 }); await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString())).toContain('classroom');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('Page 2 of 5', { exact: true })).toBeVisible();
  const source = await PDFDocument.load(original);
  const lesson = newBoard(); lesson.kind = 'document'; lesson.title = 'Export verification';
  lesson.source = { name: 'teaching.pdf', kind: 'pdf', data: toBase64(original) };
  lesson.pages = source.getPages().map((p, i) => {
    const crop = p.getCropBox(), rotated = p.getRotation().angle % 180 !== 0;
    return {
      id: `page-${i}`, width: rotated ? crop.height : crop.width, height: rotated ? crop.width : crop.height,
      background: '#ffffff', pattern: 'plain',
      annotations: [
        { id: `rect-${i}`, type: 'rectangle', points: [{ x: 100, y: 100, pressure: 0.5 }, { x: 250, y: 200, pressure: 0.5 }], color: '#ff0000', width: 8, opacity: 1 },
        { id: `text-${i}`, type: 'text', text: 'Overlay text', fontSize: 24, points: [{ x: 100, y: 250, pressure: 0.5 }], color: '#008800', width: 1, opacity: 1 },
        { id: `arrow-${i}`, type: 'arrow', points: [{ x: 320, y: 110, pressure: 0.5 }, { x: 400, y: 180, pressure: 0.5 }], color: '#ff0000', width: 5, opacity: 1 },
        { id: `highlight-${i}`, type: 'highlighter', points: [{ x: 100, y: 320, pressure: 0.5 }, { x: 250, y: 320, pressure: 0.5 }], color: '#ffff00', width: 20, opacity: 0.3 },
      ],
    };
  });
  await importBytes(page, 'verify.teacherstudio', new TextEncoder().encode(serializeProject(lesson)));
  const exported = await download(page, 'pdf');
  await writeFile(testInfo.outputPath('annotated-mixed.pdf'), exported);
  await writeFile(testInfo.outputPath('original-mixed.pdf'), original);
  const output = await PDFDocument.load(exported);
  expect(output.getPageCount()).toBe(5);
  for (let i = 0; i < 5; i++) {
    expect(output.getPage(i).getSize()).toEqual(source.getPage(i).getSize());
    expect(output.getPage(i).getCropBox()).toEqual(source.getPage(i).getCropBox());
    expect(output.getPage(i).getRotation()).toEqual(source.getPage(i).getRotation());
  }
  const noInk = await download(page, 'pdf', false, false);
  const current = await PDFDocument.load(await download(page, 'pdf', true));
  expect(current.getPageCount()).toBe(1);
  await importBytes(page, 'exported.pdf', exported);
  const inspection = await page.evaluate(async ({ bytes, clean }) => {
    const modulePath = '/src/pdf.ts';
    const { openPdf }: typeof import('../src/pdf') = await import(modulePath);
    const doc = await openPdf(new Uint8Array(bytes)), plain = await openPdf(new Uint8Array(clean));
    const results = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i), base = await plain.getPage(i);
      const viewport = p.getViewport({ scale: 1 }), canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await p.render({ canvas, viewport }).promise;
      const ctx = canvas.getContext('2d')!;
      const red = Array.from(ctx.getImageData(100, 150, 1, 1).data);
      const untouched = Array.from(ctx.getImageData(450, 350, 1, 1).data);
      const greenArea = ctx.getImageData(98, 248, 180, 40).data;
      let green = 0;
      for (let j = 0; j < greenArea.length; j += 4) if (greenArea[j + 1] > greenArea[j] + 30 && greenArea[j + 1] > greenArea[j + 2] + 30) green++;
      const baseCanvas = document.createElement('canvas'); baseCanvas.width = viewport.width; baseCanvas.height = viewport.height;
      await base.render({ canvas: baseCanvas, viewport }).promise;
      const without = Array.from(baseCanvas.getContext('2d')!.getImageData(100, 150, 1, 1).data);
      const text = await p.getTextContent();
      results.push({ red, untouched, without, green, text: text.items.filter((item): item is typeof item & { str: string } => 'str' in item).map(item => item.str).join(' ') });
    }
    await doc.loadingTask.destroy(); await plain.loadingTask.destroy();
    return results;
  }, { bytes: Array.from(exported), clean: Array.from(noInk) });
  for (const [i, result] of inspection.entries()) {
    expect(result.red[0]).toBeGreaterThan(240); expect(result.red[1]).toBeLessThan(20); expect(result.red[2]).toBeLessThan(20);
    expect(result.without).not.toEqual(result.red);
    expect(result.green).toBeGreaterThan(30);
    expect(result.text).toContain(`Original classroom content - page ${i + 1}`);
  }
});

test('rejects invalid files and provides an honest presentation fallback', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import presentation', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('LibreOffice');
  await page.getByLabel('Dismiss notification').click();
  await page.getByLabel('Import document or project').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByLabel('Dismiss notification').click();
  await page.getByLabel('Import document or project').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('empty');
});

test('object selection, movement, resize, deletion, eraser and zoom preserve document geometry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New whiteboard', exact: false }).click();
  const canvas = page.getByTestId('annotation-canvas'), box = (await canvas.boundingBox())!, scale = box.width / 1600;
  const drag = async (x: number, y: number, dx: number, dy: number) => {
    await page.mouse.move(box.x + x * scale, box.y + y * scale); await page.mouse.down();
    await page.mouse.move(box.x + (x + dx) * scale, box.y + (y + dy) * scale, { steps: 10 }); await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(150, 150, 200, 150);
  const rectangle = canvas.locator('rect[stroke="#173a43"]');
  await expect(rectangle).toHaveAttribute('width', '200');
  await page.getByRole('button', { name: 'Select / PDF text (V)', exact: true }).click();
  await drag(150, 180, 60, 40);
  await expect(rectangle).toHaveAttribute('x', '210');
  await expect(rectangle).toHaveAttribute('y', '190');
  await drag(410, 340, 80, 60);
  await expect.poll(async () => Number(await rectangle.getAttribute('width'))).toBeCloseTo(280, 5);
  await expect.poll(async () => Number(await rectangle.getAttribute('height'))).toBeCloseTo(210, 5);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(rectangle).toHaveAttribute('x', '210');
  await page.getByRole('button', { name: 'Delete selected object' }).click();
  await expect(rectangle).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(rectangle).toHaveCount(1);
  await page.getByRole('button', { name: 'Whole-object eraser (E)', exact: true }).click();
  const zoomed = (await canvas.boundingBox())!, zoomScale = zoomed.width / 1600;
  await canvas.click({ position: { x: 210 * zoomScale, y: 210 * zoomScale } });
  await expect(rectangle).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(rectangle).toHaveCount(1);
});

test('image backgrounds, page export, library organization and all-local requests', async ({ page, context }) => {
  const remote: string[] = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    remote.push(url.href); return route.abort();
  });
  await page.goto('/');
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#0088ff'; ctx.fillRect(0, 0, 400, 300);
    return Array.from(new Uint8Array(await (await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'))).arrayBuffer()));
  });
  await importBytes(page, 'teaching-image.png', new Uint8Array(png));
  await expect(page.getByRole('img', { name: 'teaching-image.png' })).toBeVisible();
  await expect.poll(() => visiblePaperPixel(page, 200, 150, 400, 300)).toEqual([0, 136, 255, 255]);
  const output = await PDFDocument.load(await download(page, 'pdf'));
  expect(output.getPage(0).getSize()).toEqual({ width: 400, height: 300 });
  await page.getByRole('button', { name: 'teaching-image', exact: true }).click();
  await page.getByLabel('Lesson title').fill('Algorithms');
  await page.getByLabel('Subject', { exact: true }).fill('Computer Science');
  await page.getByLabel('Folder', { exact: true }).fill('Class 10');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByRole('button', { name: 'Back to lessons' }).click();
  await page.getByLabel('Search lessons').fill('Algorithms');
  await page.getByLabel('Filter by folder').selectOption('Class 10');
  await expect(page.getByRole('button', { name: 'Open Algorithms', exact: true })).toBeVisible();
  await page.getByLabel('Actions for Algorithms').click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Algorithms (copy)', exact: true })).toBeVisible();
  expect(remote).toEqual([]);
});

test('packaged-assets PDF workflow imports, annotates, exports and reopens without source modules', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await importBytes(page, 'teaching.pdf', await fixture());
  const canvas = page.getByTestId('annotation-canvas'), box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Highlighter (M)', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 120); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 120, { steps: 10 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 180); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 250, { steps: 10 }); await page.mouse.up();
  const exported = await download(page, 'pdf');
  expect((await PDFDocument.load(exported)).getPageCount()).toBe(5);
  await importBytes(page, 'annotated-reopen.pdf', exported);
  await expect(page.locator('.paper canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Select / PDF text (V)', exact: true }).click();
  await expect(page.locator('.paper .textLayer')).toContainText('Original classroom content');
  expect(errors).toEqual([]);
});
