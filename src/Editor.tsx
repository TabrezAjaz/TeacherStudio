import { useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { AnnotationObject, Background } from './Annotations';
import { PdfPage } from './PdfPage';
import { bounds, documentPoint, hitTest, resize, translate } from './geometry';
import type { Annotation, Lesson, Point, Tool } from './model';

interface Props {
  lesson: Lesson; index: number; zoom: number; tool: Tool; color: string; width: number; opacity: number;
  document?: PDFDocumentProxy; selected: string | null; onSelect(id: string | null): void;
  onChange(annotations: Annotation[]): void;
  onText(point: Point, annotation?: Annotation): void;
}
type Gesture = { start: Point; original: Annotation[]; selected?: Annotation; resizing?: boolean; draft?: Annotation; erased?: Set<string> };

export default function Editor(props: Props) {
  const { lesson, index, zoom, tool, color, width, opacity, document: doc, selected, onSelect, onChange, onText } = props;
  const page = lesson.pages[index], svg = useRef<SVGSVGElement>(null), scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [preview, setPreview] = useState<Annotation[] | null>(null);
  const [laser, setLaser] = useState<Point | null>(null);
  const laserTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    gesture.current = null; setPreview(null); onSelect(null);
  }, [page.id, tool, onSelect]);
  useEffect(() => () => { if (laserTimer.current) clearTimeout(laserTimer.current); }, []);
  const at = (event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>): Point => documentPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), page.width, page.height, 'pressure' in event ? event.pressure : 0.5);
  const markLaser = (point: Point) => {
    setLaser(point);
    if (laserTimer.current) clearTimeout(laserTimer.current);
    laserTimer.current = setTimeout(() => setLaser(null), 650);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const p = at(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'laser') { markLaser(p); return; }
    if (tool === 'pan') {
      if (scroller.current) pan.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
      return;
    }
    const objects = page.annotations;
    if (tool === 'text') {
      const existing = [...objects].reverse().find(a => a.type === 'text' && hitTest(a, p));
      onText(p, existing); return;
    }
    if (tool === 'select') {
      const current = objects.find(a => a.id === selected);
      const b = current && bounds(current);
      const resizing = b && Math.hypot(p.x - b.x - b.width, p.y - b.y - b.height) < 14 / zoom;
      const target = resizing ? current : [...objects].reverse().find(a => hitTest(a, p, 8 / zoom));
      onSelect(target?.id ?? null);
      if (target) gesture.current = { start: p, original: objects, selected: target, resizing: !!resizing };
      return;
    }
    if (tool === 'eraser') {
      const erased = new Set(objects.filter(a => hitTest(a, p, width + 5 / zoom)).map(a => a.id));
      gesture.current = { start: p, original: objects, erased };
      setPreview(objects.filter(a => !erased.has(a.id)));
      return;
    }
    const draft: Annotation = {
      id: crypto.randomUUID(), type: tool, points: [p], color,
      width: tool === 'highlighter' ? width * 5 : width, opacity: tool === 'highlighter' ? Math.min(opacity, 0.35) : opacity,
    };
    gesture.current = { start: p, original: objects, draft };
    setPreview([...objects, draft]);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (pan.current && scroller.current) {
      scroller.current.scrollLeft = pan.current.left - event.clientX + pan.current.x;
      scroller.current.scrollTop = pan.current.top - event.clientY + pan.current.y; return;
    }
    const p = at(event);
    if (tool === 'laser') { markLaser(p); return; }
    const g = gesture.current;
    if (!g) return;
    if (g.erased) {
      for (const object of g.original) if (hitTest(object, p, width + 5 / zoom)) g.erased.add(object.id);
      setPreview(g.original.filter(a => !g.erased!.has(a.id)));
    } else if (g.selected) {
      const b = bounds(g.selected);
      const transformed = g.resizing ? resize(g.selected, p.x - b.x, p.y - b.y) : translate(g.selected, p.x - g.start.x, p.y - g.start.y);
      setPreview(g.original.map(a => a.id === transformed.id ? transformed : a));
    } else if (g.draft) {
      const draft = g.draft;
      if (draft.type === 'pen' || draft.type === 'highlighter') {
        const native = event.nativeEvent;
        const events = native.getCoalescedEvents?.() ?? [native];
        const rect = event.currentTarget.getBoundingClientRect();
        const additions = events.map(e => documentPoint(e.clientX, e.clientY, rect, page.width, page.height, e.pressure));
        for (const point of additions) {
          const last = draft.points[draft.points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.5) draft.points.push(point);
        }
      } else draft.points = [g.start, p];
      setPreview([...g.original, { ...draft, points: [...draft.points] }]);
    }
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    if (gesture.current) {
      const g = gesture.current;
      if (g.draft) {
        const draft = { ...g.draft, points: [...g.draft.points] };
        onChange([...g.original, draft]);
      } else if (preview) onChange(preview);
    }
    gesture.current = null; pan.current = null; setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const objects = preview ?? page.annotations;
  const selection = objects.find(a => a.id === selected), box = selection && bounds(selection);
  return <div ref={scroller} className={`workspace tool-${tool}`} data-testid="workspace">
    <div className="paper-surround">
      <div className="paper" style={{ width: page.width * zoom, height: page.height * zoom }}>
        <svg className="paper-background" viewBox={`0 0 ${page.width} ${page.height}`}><Background page={page} /></svg>
        {doc && <PdfPage document={doc} index={index} width={page.width * zoom} selectable={tool === 'select' && !selected} />}
        {lesson.source?.kind === 'image' && <img className="source-image" alt={lesson.source.name} src={`data:image/${lesson.source.name.split('.').pop() === 'jpg' ? 'jpeg' : lesson.source.name.split('.').pop()};base64,${lesson.source.data}`} />}
        <svg ref={svg} className="annotation-layer" data-testid="annotation-canvas" aria-label="Drawing canvas"
          style={{ pointerEvents: tool === 'select' && !selected && doc ? 'none' : 'auto' }}
          viewBox={`0 0 ${page.width} ${page.height}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={end}
          onPointerCancel={() => { gesture.current = null; pan.current = null; setPreview(null); }}
          onDoubleClick={e => {
            const point = at(e), object = [...objects].reverse().find(a => hitTest(a, point));
            if (object?.type === 'text') onText(point, object);
          }}>
          {objects.map(a => <g key={a.id} style={{ pointerEvents: tool === 'select' ? 'visiblePainted' : undefined }}>
            <AnnotationObject annotation={a} />
          </g>)}
          {box && tool === 'select' && <g className="selection" strokeWidth={1.5 / zoom}>
            <rect x={box.x - 4} y={box.y - 4} width={box.width + 8} height={box.height + 8} fill="none" stroke="#0d9488" strokeDasharray="5 4" />
            <rect x={box.x + box.width - 6 / zoom} y={box.y + box.height - 6 / zoom} width={12 / zoom} height={12 / zoom} fill="white" stroke="#0d9488" />
          </g>}
          {laser && <circle cx={laser.x} cy={laser.y} r={7 / zoom} fill="#ff613b" stroke="#ffffff" strokeWidth={2 / zoom} className="laser" />}
        </svg>
      </div>
    </div>
  </div>;
}
