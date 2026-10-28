import { useEffect, useRef, useState } from 'react';
import { pdfjs } from './pdf';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import './text-layer.css';

export function PdfPage({ document: doc, index, width, selectable, thumbnail = false }: {
  document: PDFDocumentProxy; index: number; width: number; selectable: boolean; thumbnail?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, task: RenderTask | undefined, layer: TextLayer | undefined, loadedPage: PDFPageProxy | undefined;
    setError('');
    void (async () => {
      const page = await doc.getPage(index + 1);
      loadedPage = page;
      if (!active || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const ratio = thumbnail ? 1 : Math.min(devicePixelRatio || 1, 2);
      const scale = Math.min(width * ratio / base.width, Math.sqrt(16000000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const node = canvas.current;
      node.width = Math.ceil(viewport.width); node.height = Math.ceil(viewport.height);
      task = page.render({ canvas: node, viewport });
      await task.promise;
      if (active && text.current && selectable && !thumbnail) {
        text.current.replaceChildren();
        const textViewport = page.getViewport({ scale: width / base.width });
        text.current.style.setProperty('--scale-factor', String(width / base.width));
        layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text.current, viewport: textViewport });
        await layer.render();
      }
    })().catch(error => {
      if (active && error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException')
        setError(`Page ${index + 1} could not render: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => { active = false; task?.cancel(); layer?.cancel(); loadedPage?.cleanup(); };
  }, [doc, index, width, selectable, thumbnail]);
  return <>
    <canvas className="pdf-canvas" ref={canvas} aria-label={`PDF page ${index + 1}`} />
    {!thumbnail && <div ref={text} className="textLayer" style={{ pointerEvents: selectable ? 'auto' : 'none', display: selectable ? 'block' : 'none' }} />}
    {error && <div className="page-error" role="alert">{error}</div>}
  </>;
}
