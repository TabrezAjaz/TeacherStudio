import type { Annotation, Point } from './model';

export function documentPoint(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>, width: number, height: number, pressure = 0.5): Point {
  return {
    x: Math.max(0, Math.min(width, (clientX - rect.left) / rect.width * width)),
    y: Math.max(0, Math.min(height, (clientY - rect.top) / rect.height * height)),
    pressure: pressure || 0.5,
  };
}

export function bounds(a: Annotation) {
  const xs = a.points.map(p => p.x), ys = a.points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  if (a.type === 'text') {
    const lines = (a.text ?? '').split('\n'), size = a.fontSize ?? 24;
    return { x, y, width: Math.max(size, ...lines.map(l => Array.from(l).length * size * 0.65)), height: lines.length * size * 1.3 };
  }
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) };
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  return { ...a, points: a.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) };
}

export function resize(a: Annotation, width: number, height: number): Annotation {
  const b = bounds(a), sx = Math.max(1, width) / b.width, sy = Math.max(1, height) / b.height;
  return {
    ...a, points: a.points.map(p => ({ ...p, x: b.x + (p.x - b.x) * sx, y: b.y + (p.y - b.y) * sy })),
    ...(a.type === 'text' ? { fontSize: Math.min(200, Math.max(8, (a.fontSize ?? 24) * sy)) } : {}),
  };
}

export function hitTest(a: Annotation, p: Point, tolerance = 8): boolean {
  const b = bounds(a);
  if (a.type === 'text' || a.type === 'rectangle' || a.type === 'ellipse')
    return p.x >= b.x - tolerance && p.x <= b.x + b.width + tolerance && p.y >= b.y - tolerance && p.y <= b.y + b.height + tolerance;
  if (a.points.length === 1) return Math.hypot(p.x - a.points[0].x, p.y - a.points[0].y) <= tolerance + a.width;
  return a.points.slice(1).some((end, i) => {
    const start = a.points[i], dx = end.x - start.x, dy = end.y - start.y;
    const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - start.x - t * dx, p.y - start.y - t * dy) <= tolerance + a.width / 2;
  });
}

export function arrowHead(a: Annotation): string {
  const start = a.points[0], end = a.points[a.points.length - 1];
  const angle = Math.atan2(end.y - start.y, end.x - start.x), length = Math.max(12, a.width * 4);
  return `${end.x - length * Math.cos(angle - Math.PI / 6)},${end.y - length * Math.sin(angle - Math.PI / 6)} ${end.x},${end.y} ${end.x - length * Math.cos(angle + Math.PI / 6)},${end.y - length * Math.sin(angle + Math.PI / 6)}`;
}
