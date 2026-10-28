import { z } from 'zod';

export const MAX_FILE_BYTES = 75 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 150 * 1024 * 1024;
const finite = z.number().finite();
const coordinate = finite.min(-100000).max(100000);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const pointSchema = z.object({ x: coordinate, y: coordinate, pressure: finite.min(0).max(1) });
export const annotationSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['pen', 'highlighter', 'line', 'arrow', 'rectangle', 'ellipse', 'text']),
  points: z.array(pointSchema).min(1).max(100000),
  color,
  width: finite.min(0.1).max(100),
  opacity: finite.min(0.05).max(1),
  text: z.string().max(10000).optional(),
  fontSize: finite.min(8).max(200).optional(),
});
export const pageSchema = z.object({
  id: z.string().min(1).max(100),
  width: finite.min(10).max(16000),
  height: finite.min(10).max(16000),
  background: color,
  pattern: z.enum(['plain', 'dots', 'grid']),
  annotations: z.array(annotationSchema).max(50000),
});
const sourceSchema = z.object({
  name: z.string().max(255),
  kind: z.enum(['pdf', 'image']),
  data: z.string().min(1).max(110000000),
});
export const lessonSchema = z.object({
  schemaVersion: z.literal(1),
  appVersion: z.literal('0.1.0'),
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  subject: z.string().max(200),
  grade: z.string().max(100),
  topic: z.string().max(200),
  folder: z.string().max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  kind: z.enum(['whiteboard', 'document']),
  pages: z.array(pageSchema).min(1).max(2000),
  source: sourceSchema.optional(),
}).superRefine((lesson, ctx) => {
  if (lesson.kind === 'document' && !lesson.source)
    ctx.addIssue({ code: 'custom', message: 'Document source is missing. Import the original again.' });
  if (new Set(lesson.pages.map(p => p.id)).size !== lesson.pages.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate page identifiers.' });
  for (const page of lesson.pages) {
    if (new Set(page.annotations.map(a => a.id)).size !== page.annotations.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate annotation identifiers.' });
  }
});
export type Point = z.infer<typeof pointSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Tool = Annotation['type'] | 'select' | 'eraser' | 'pan' | 'laser';
export type Template = 'blank' | 'dots' | 'grid' | 'flowchart' | 'mindmap' | 'brainstorm' | 'code';

export function newBoard(template: Template = 'blank'): Lesson {
  const now = new Date().toISOString();
  const labels: Record<Template, string> = {
    blank: 'Untitled whiteboard', dots: 'Dotted notebook', grid: 'Grid notebook',
    flowchart: 'Flowchart', mindmap: 'Mind map', brainstorm: 'Brainstorming', code: 'Code explanation',
  };
  const page: Page = {
    id: crypto.randomUUID(), width: 1600, height: 1000, background: '#ffffff',
    pattern: template === 'dots' ? 'dots' : template === 'grid' || template === 'code' ? 'grid' : 'plain',
    annotations: [],
  };
  const text = (value: string, x: number, y: number, fontSize = 28): Annotation => ({
    id: crypto.randomUUID(), type: 'text', points: [{ x, y, pressure: 0.5 }],
    text: value, fontSize, color: '#173a43', width: 2, opacity: 1,
  });
  const box = (x: number, y: number, w: number, h: number): Annotation => ({
    id: crypto.randomUUID(), type: 'rectangle', points: [{ x, y, pressure: 0.5 }, { x: x + w, y: y + h, pressure: 0.5 }],
    color: '#0d9488', width: 3, opacity: 1,
  });
  const arrow = (x: number, y: number, endX: number, endY: number): Annotation => ({
    id: crypto.randomUUID(), type: 'arrow', points: [{ x, y, pressure: 0.5 }, { x: endX, y: endY, pressure: 0.5 }],
    color: '#0d9488', width: 3, opacity: 1,
  });
  if (template === 'flowchart') page.annotations = [
    box(600, 150, 360, 140), text('Start / input', 660, 200),
    arrow(780, 300, 780, 430), box(600, 450, 360, 140), text('Process', 690, 500),
    arrow(780, 600, 780, 730), box(600, 750, 360, 140), text('Output', 690, 800),
  ];
  if (template === 'mindmap' || template === 'brainstorm') page.annotations = [
    box(600, 400, 360, 150), text('Central idea', 660, 455),
    arrow(600, 450, 340, 250), arrow(960, 450, 1220, 250),
    arrow(600, 500, 340, 750), arrow(960, 500, 1220, 750),
    text('Explore', 200, 190), text('Connect', 1150, 190),
    text('Questions', 180, 790), text('Next steps', 1150, 790),
  ];
  if (template === 'code') page.annotations = [
    text('Code & concepts', 90, 75, 38), box(80, 160, 900, 730),
    text('Write your code here', 120, 200, 24), text('Trace / explain', 1060, 190, 28),
  ];
  return {
    schemaVersion: 1, appVersion: '0.1.0', id: crypto.randomUUID(), title: labels[template],
    subject: '', grade: '', topic: '', folder: '', createdAt: now, updatedAt: now,
    kind: 'whiteboard', pages: [page],
  };
}

export function serializeProject(lesson: Lesson): string {
  return JSON.stringify(lessonSchema.parse(lesson));
}

export function deserializeProject(text: string): Lesson {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This project is not valid JSON. The file may be damaged.'); }
  const result = lessonSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid or unsupported project: ${result.error.issues[0]?.message}`);
  return result.data;
}

export function toBase64(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}

export function fromBase64(data: string): Uint8Array {
  try { return Uint8Array.from(atob(data), c => c.charCodeAt(0)); }
  catch { throw new Error('The bundled source document is damaged (invalid base64).'); }
}

export function pageIndex(index: number, delta: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index + delta));
}
