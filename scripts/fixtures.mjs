import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = join('tests', 'fixtures');
await mkdir(directory, { recursive: true });
for (const mixed of [false, true]) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) {
    const page = pdf.addPage(mixed && i === 1 ? [842, 595] : [595, 842]);
    if (mixed && i === 2) { page.setRotation(degrees(90)); page.setCropBox(15, 20, 560, 800); }
    page.drawText(`Computer Science - Lesson ${i + 1}`, { x: 60, y: 700, font, size: 22 });
    page.drawText(['Inputs, processing and outputs', 'Flowcharts make algorithms visible', 'Trace a loop one step at a time'][i], { x: 60, y: 500, font, size: 16 });
    page.drawRectangle({ x: 60, y: 180, width: 150, height: 120, color: rgb(0.1, 0.6, 0.5) });
  }
  await writeFile(join(directory, mixed ? 'mixed-orientations.pdf' : 'multi-page.pdf'), await pdf.save());
}
const now = '2026-10-28T00:00:00.000Z';
await writeFile(join(directory, 'editable-whiteboard.teacherstudio'), JSON.stringify({
  schemaVersion: 1, appVersion: '0.1.0', id: 'fixture-board', title: 'Editable teaching fixture',
  subject: 'Computer Science', grade: '10', topic: 'Algorithms', folder: 'Fixtures',
  createdAt: now, updatedAt: now, kind: 'whiteboard',
  pages: [{
    id: 'fixture-page', width: 1600, height: 1000, background: '#fff5ce', pattern: 'dots',
    annotations: [
      { id: 'ink', type: 'pen', color: '#0d9488', width: 4, opacity: 1, points: [{ x: 100, y: 200, pressure: 0.3 }, { x: 170, y: 150, pressure: 1 }, { x: 230, y: 210, pressure: 0.5 }] },
      { id: 'box', type: 'rectangle', color: '#e8793a', width: 3, opacity: 1, points: [{ x: 400, y: 150, pressure: 0.5 }, { x: 800, y: 400, pressure: 0.5 }] },
      { id: 'text', type: 'text', text: 'Inputs → processing → outputs', fontSize: 32, color: '#173a43', width: 1, opacity: 1, points: [{ x: 100, y: 550, pressure: 0.5 }] },
    ],
  }],
}, null, 2));
console.log(`Generated PDF and editable whiteboard fixtures in ${directory}`);
