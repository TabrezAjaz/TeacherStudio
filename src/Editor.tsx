import { useCallback, useEffect, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
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
type Gesture = {
  start: Point; original: Annotation[]; commit(annotations: Annotation[]): void;
  selected?: Annotation; resizing?: boolean; draft?: Annotation; erased?: Set<string>;
};

export default function Editor(props: Props) {
  const { lesson, index, zoom, tool, color, width, opacity, document: doc, selected, onSelect, onChange, onText } = props;
  const page = lesson.pages[index], svg = useRef<SVGSVGElement>(null), scroller = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null), pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const activePointer = useRef<number | null>(null), frame = useRef<number | null>(null);
  const activePointerType = useRef<string | null>(null);
  const previewRef = useRef<Annotation[] | null>(null);
  const [preview, setPreview] = useState<Annotation[] | null>(null);
  const [laser, setLaser] = useState<Point | null>(null);
  const laserTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = useCallback((save = true) => {
    const g = gesture.current, pointerId = activePointer.current, node = svg.current;
    const result = g?.draft ? [...g.original, { ...g.draft, points: [...g.draft.points] }] : previewRef.current;
    gesture.current = null; pan.current = null; activePointer.current = null; activePointerType.current = null; previewRef.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(null);
    if (pointerId !== null && node?.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
    if (save && g && result) g.commit(result);
    return save ? result : null;
  }, []);
  const queuePreview = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const g = gesture.current;
      setPreview(g?.draft ? [...g.original, { ...g.draft, points: [...g.draft.points] }] : previewRef.current);
    });
  };
  useEffect(() => {
    finish(false); onSelect(null);
  }, [page.id, tool, onSelect, finish]);
  useEffect(() => { finish(false); }, [zoom, finish]);
  useEffect(() => {
    const blur = () => { finish(); };
    const hidden = () => { if (window.document.visibilityState === 'hidden') finish(); };
    window.addEventListener('blur', blur);
    window.document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur);
      window.document.removeEventListener('visibilitychange', hidden);
      finish(false);
    };
  }, [finish]);
  useEffect(() => () => { if (laserTimer.current) clearTimeout(laserTimer.current); }, []);
  const at = (event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>): Point => documentPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), page.width, page.height, 'pressure' in event ? event.pressure : 0.5);
  const markLaser = (point: Point) => {
    setLaser(point);
    if (laserTimer.current) clearTimeout(laserTimer.current);
    laserTimer.current = setTimeout(() => setLaser(null), 650);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const penTakeover = event.pointerType === 'pen' && activePointerType.current !== 'pen';
    if (activePointer.current !== null && activePointer.current !== event.pointerId && activePointerType.current !== event.pointerType && !penTakeover) return;
    const completed = activePointer.current !== null ? finish(!penTakeover) : null;
    const p = at(event);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    activePointerType.current = event.pointerType;
    if (tool === 'laser') { markLaser(p); return; }
    if (tool === 'pan') {
      if (scroller.current) pan.current = { x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
      return;
    }
    const objects = completed ?? page.annotations;
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
      if (target) gesture.current = { start: p, original: objects, commit: onChange, selected: target, resizing: !!resizing };
      return;
    }
    if (tool === 'eraser') {
      const erased = new Set(objects.filter(a => hitTest(a, p, width + 5 / zoom)).map(a => a.id));
      gesture.current = { start: p, original: objects, commit: onChange, erased };
      previewRef.current = objects.filter(a => !erased.has(a.id));
      queuePreview();
      return;
    }
    const draft: Annotation = {
      id: crypto.randomUUID(), type: tool, points: [p], color,
      width: tool === 'highlighter' ? width * 5 : width, opacity: tool === 'highlighter' ? Math.min(opacity, 0.35) : opacity,
    };
    gesture.current = { start: p, original: objects, commit: onChange, draft };
    queuePreview();
  };
  const updateGesture = (event: PointerEvent<SVGSVGElement>) => {
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
      previewRef.current = g.original.filter(a => !g.erased!.has(a.id));
    } else if (g.selected) {
      const b = bounds(g.selected);
      const transformed = g.resizing ? resize(g.selected, p.x - b.x, p.y - b.y) : translate(g.selected, p.x - g.start.x, p.y - g.start.y);
      previewRef.current = g.original.map(a => a.id === transformed.id ? transformed : a);
    } else if (g.draft) {
      const draft = g.draft;
      if (draft.type === 'pen' || draft.type === 'highlighter') {
        const native = event.nativeEvent;
        const events = [...(native.getCoalescedEvents?.() ?? []), native];
        const rect = event.currentTarget.getBoundingClientRect();
        const additions = events.map(e => documentPoint(e.clientX, e.clientY, rect, page.width, page.height, e.pressure));
        for (const point of additions) {
          const last = draft.points[draft.points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) >= 0.5) draft.points.push(point);
        }
      } else draft.points = [g.start, p];
    }
    queuePreview();
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current === null) {
      if (tool === 'laser' && event.isPrimary) markLaser(at(event));
      return;
    }
    if (activePointer.current !== event.pointerId) return;
    if (!(event.buttons & 1)) { finish(); return; }
    event.preventDefault();
    updateGesture(event);
  };
  const end = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    updateGesture(event);
    finish();
  };
  const interrupted = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current === event.pointerId) finish();
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
          onPointerCancel={interrupted} onLostPointerCapture={interrupted}
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
