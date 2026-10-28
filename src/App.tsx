import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight,
  Circle, Copy, Download, Eraser, Expand, FileText, FolderOpen, Grid2X2, Hand, Highlighter,
  Home, LayoutTemplate, Maximize, Minus, MoreHorizontal, MousePointer2, PanelLeftClose,
  PenLine, Plus, Presentation, Redo2, Search, Settings, Sparkles, Square, Trash2, Type, Undo2, X, Zap,
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isTauri } from '@tauri-apps/api/core';
import Editor from './Editor';
import { PdfPage } from './PdfPage';
import { Background, AnnotationObject } from './Annotations';
import { newBoard, fromBase64, serializeProject, pageIndex, type Annotation, type Lesson, type Page, type Point, type Template, type Tool } from './model';
import { commit, history, redo, undo, type History } from './history';
import { deleteLesson, journal, loadLessons, saveLesson } from './storage';
import { importFile, openPdf } from './pdf';
import { canvasPng, compositePage, exportPdf } from './export';
import { importPresentation, saveExport } from './platform';

type Nav = 'Home' | 'My Lessons' | 'Documents' | 'Whiteboards' | 'Templates' | 'Recent Files' | 'Settings';
type Modal = { type: 'metadata'; lesson: Lesson } | { type: 'text'; point: Point; annotation?: Annotation } | { type: 'export' } | { type: 'help' } | null;
const templates: { id: Template; label: string; caption: string }[] = [
  { id: 'blank', label: 'Blank notebook', caption: 'A fresh space for ideas' },
  { id: 'dots', label: 'Dotted notebook', caption: 'Structure, without the rules' },
  { id: 'grid', label: 'Grid notebook', caption: 'Make every concept line up' },
  { id: 'flowchart', label: 'Flowchart', caption: 'One step at a time' },
  { id: 'mindmap', label: 'Mind map', caption: 'Connect the bigger picture' },
  { id: 'brainstorm', label: 'Brainstorming', caption: 'Let the ideas branch out' },
  { id: 'code', label: 'Code explanation', caption: 'From syntax to understanding' },
];
const tools: { id: Tool; label: string; icon: typeof PenLine; shortcut?: string }[] = [
  { id: 'select', label: 'Select / PDF text', icon: MousePointer2, shortcut: 'V' },
  { id: 'pan', label: 'Pan', icon: Hand, shortcut: 'H' },
  { id: 'pen', label: 'Pen', icon: PenLine, shortcut: 'P' },
  { id: 'highlighter', label: 'Highlighter', icon: Highlighter, shortcut: 'M' },
  { id: 'eraser', label: 'Whole-object eraser', icon: Eraser, shortcut: 'E' },
  { id: 'text', label: 'Text box', icon: Type, shortcut: 'T' },
  { id: 'line', label: 'Straight line', icon: Minus },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'laser', label: 'Temporary laser pointer', icon: Zap, shortcut: 'L' },
];
const colors = ['#173a43', '#0d9488', '#e8793a', '#d84f68', '#7861ba', '#3679c2', '#ffffff'];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function IconButton({ label, children, ...rest }: { label: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="icon-button" title={label} aria-label={label} {...rest}>{children}</button>;
}

function Preview({ lesson, compact = false }: { lesson: Lesson; compact?: boolean }) {
  const page = lesson.pages[0];
  return <div className={`lesson-preview ${lesson.kind} ${compact ? 'compact' : ''}`}>
    {lesson.kind === 'document' && !page.annotations.length
      ? <div className="document-cover"><FileText size={compact ? 30 : 46} strokeWidth={1.3} /><span>{lesson.source?.name}</span></div>
      : <svg viewBox={`0 0 ${page.width} ${page.height}`}><Background page={page} id={`preview-${lesson.id}`} />{page.annotations.map(a => <AnnotationObject key={a.id} annotation={a} />)}</svg>}
    <span className="preview-type">{lesson.kind === 'document' ? 'PDF / DOCUMENT' : 'WHITEBOARD'}</span>
  </div>;
}

function Thumbnail({ doc, page, index, active, onClick }: { doc?: PDFDocumentProxy; page: Page; index: number; active: boolean; onClick(): void }) {
  const ref = useRef<HTMLButtonElement>(null), [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <button ref={ref} className={`thumbnail ${active ? 'active' : ''}`} onClick={onClick} aria-label={`Go to page ${index + 1}`} aria-current={active ? 'page' : undefined}>
    <div style={{ aspectRatio: `${page.width}/${page.height}` }}>
      {visible && <>
        {doc && <PdfPage document={doc} index={index} width={110} selectable={false} thumbnail />}
        <svg viewBox={`0 0 ${page.width} ${page.height}`}>{!doc && <Background page={page} id={`thumb-${page.id}`} />}{page.annotations.map(a => <AnnotationObject key={a.id} annotation={a} />)}</svg>
      </>}
    </div><span>{index + 1}</span>
  </button>;
}

export default function App() {
  const [lessons, setLessons] = useState<Lesson[]>([]), [active, setActive] = useState<Lesson | null>(null);
  const [nav, setNav] = useState<Nav>('Home'), [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving' | 'Save failed'>('Saved');
  const [index, setIndex] = useState(0), [zoom, setZoom] = useState(0.65), [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#173a43'), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(1);
  const [selected, setSelected] = useState<string | null>(null), [pageHistory, setPageHistory] = useState<History<Page[]> | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>(), [presenting, setPresenting] = useState(false);
  const [showPages, setShowPages] = useState(true), [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState(''), [sort, setSort] = useState('recent'), [folder, setFolder] = useState('');
  const fileInput = useRef<HTMLInputElement>(null), queue = useRef<Promise<void>>(Promise.resolve());
  const activeRef = useRef<Lesson | null>(null), savedRef = useRef<Lesson | null>(null);
  const notifyError = useCallback((error: unknown) => setNotice({ text: message(error), error: true }), []);

  useEffect(() => {
    let mounted = true;
    loadLessons().then(result => { if (mounted) setLessons(result); })
      .catch(error => { if (mounted) { setLoadFailed(true); notifyError(error); } })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [notifyError]);

  const persist = useCallback((lesson: Lesson): Promise<void> => {
    setSaveStatus('Saving');
    const operation = queue.current.catch(() => undefined).then(() => saveLesson(lesson));
    queue.current = operation;
    void operation.then(() => {
      if (activeRef.current === lesson) { savedRef.current = lesson; setSaveStatus('Saved'); }
    }, error => { setSaveStatus('Save failed'); notifyError(error); });
    return operation;
  }, [notifyError]);

  useEffect(() => {
    if (!active || active === savedRef.current) return;
    const timer = setTimeout(() => { void persist(active).catch(() => undefined); }, 450);
    return () => clearTimeout(timer);
  }, [active, persist]);

  useEffect(() => {
    const close = (event: BeforeUnloadEvent) => {
      if (activeRef.current && savedRef.current !== activeRef.current) {
        try { journal(activeRef.current); } catch { event.preventDefault(); }
      }
    };
    window.addEventListener('beforeunload', close);
    return () => window.removeEventListener('beforeunload', close);
  }, []);

  const sourceData = active?.source?.data, sourceKind = active?.source?.kind;
  useEffect(() => {
    let mounted = true, loaded: PDFDocumentProxy | undefined;
    setPdfDocument(undefined);
    if (sourceKind === 'pdf' && sourceData) {
      void openPdf(fromBase64(sourceData)).then(doc => {
        loaded = doc;
        if (mounted) setPdfDocument(doc); else void doc.loadingTask.destroy();
      }).catch(error => { if (mounted) notifyError(error); });
    }
    return () => { mounted = false; if (loaded) void loaded.loadingTask.destroy(); };
  }, [sourceData, sourceKind, notifyError]);

  const updateLesson = useCallback((lesson: Lesson) => {
    const previous = activeRef.current ? Date.parse(activeRef.current.updatedAt) : 0;
    const next = { ...lesson, updatedAt: new Date(Math.max(Date.now(), previous + 1)).toISOString() };
    try { journal(next); } catch (error) { notifyError(error); setSaveStatus('Save failed'); }
    activeRef.current = next;
    setActive(next); setSaveStatus('Saving');
    setLessons(list => list.map(item => item.id === next.id ? next : item));
  }, [notifyError]);

  const flush = async () => {
    if (activeRef.current && savedRef.current !== activeRef.current) await persist(activeRef.current);
    else await queue.current;
  };
  const enter = async (lesson: Lesson, create = false) => {
    await flush();
    if (create) {
      await saveLesson(lesson);
      setLessons(list => [lesson, ...list.filter(item => item.id !== lesson.id)]);
    }
    activeRef.current = lesson; savedRef.current = lesson;
    setActive(lesson); setPageHistory(history(lesson.pages)); setIndex(0); setSelected(null); setTool('pen'); setSaveStatus('Saved');
    setZoom(Math.min(1, Math.max(0.15, (window.innerWidth - 420) / lesson.pages[0].width)));
  };
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try { await action(); } catch (error) { notifyError(error); }
    finally { setBusy(''); }
  };
  const createBoard = (template: Template = 'blank') => void run('Creating your workspace…', () => enter(newBoard(template), true));
  const navigate = (next: Nav) => void run('Saving your work…', async () => {
    await flush(); setActive(null); activeRef.current = null; setNav(next); setQuery(''); setFolder(''); setPresenting(false);
  });
  const changePages = (pages: Page[], record = true) => {
    if (!active || !pageHistory) return;
    if (record) setPageHistory(commit(pageHistory, pages));
    updateLesson({ ...active, pages });
  };
  const changeAnnotations = (annotations: Annotation[]) => {
    if (!active) return;
    changePages(active.pages.map((page, i) => i === index ? { ...page, annotations } : page));
  };
  const travel = (direction: 'undo' | 'redo') => {
    if (!active || !pageHistory) return;
    const next = direction === 'undo' ? undo(pageHistory) : redo(pageHistory);
    setPageHistory(next); updateLesson({ ...active, pages: next.present }); setSelected(null);
    setIndex(i => Math.min(i, next.present.length - 1));
  };
  const removeSelected = () => {
    if (active && selected) { changeAnnotations(active.pages[index].annotations.filter(a => a.id !== selected)); setSelected(null); }
  };
  const changeZoom = (value: number) => setZoom(Math.max(0.1, Math.min(4, value)));
  const fit = (mode: 'width' | 'page') => {
    if (!active) return;
    const workspace = document.querySelector('[data-testid="workspace"]');
    if (!workspace) return;
    const available = workspace.getBoundingClientRect(), page = active.pages[index];
    changeZoom(mode === 'width' ? (available.width - 80) / page.width : Math.min((available.width - 80) / page.width, (available.height - 70) / page.height));
  };
  const togglePresentation = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  useEffect(() => {
    const changed = () => setPresenting(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
      if (modal || busy) { if (event.key === 'Escape' && !busy) setModal(null); return; }
      const control = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (control && key === 'o') { event.preventDefault(); fileInput.current?.click(); }
      else if (active && control && key === 's') {
        event.preventDefault();
        if (event.shiftKey) setModal({ type: 'export' }); else void run('Saving…', flush);
      } else if (active && control && (key === 'z' || key === 'y')) {
        event.preventDefault(); travel(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      } else if (active && control && ['=', '+', '-'].includes(key)) {
        event.preventDefault(); changeZoom(zoom + (key === '-' ? -0.1 : 0.1));
      } else if (active && (key === 'pagedown' || key === 'pageup')) {
        event.preventDefault(); setIndex(pageIndex(index, key === 'pagedown' ? 1 : -1, active.pages.length));
      } else if (active && (key === 'delete' || key === 'backspace')) { event.preventDefault(); removeSelected(); }
      else if (key === 'escape') { setSelected(null); setTool('pen'); }
      else if (active && key === 'f') { event.preventDefault(); void run('Opening presentation mode…', togglePresentation); }
      else if (active && !control && !event.altKey) {
        const next = tools.find(t => t.shortcut?.toLowerCase() === key);
        if (next) setTool(next.id);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });

  const duplicate = (lesson: Lesson) => void run('Duplicating lesson…', async () => {
    const now = new Date().toISOString();
    await enter({ ...structuredClone(lesson), id: crypto.randomUUID(), title: `${lesson.title} (copy)`.slice(0, 200), createdAt: now, updatedAt: now }, true);
  });
  const remove = (lesson: Lesson) => {
    if (!window.confirm(`Permanently delete “${lesson.title}” from this device? Export a project first if you need a backup.`)) return;
    void run('Deleting lesson…', async () => {
      await flush(); await deleteLesson(lesson.id); setLessons(list => list.filter(item => item.id !== lesson.id));
      if (active?.id === lesson.id) { setActive(null); activeRef.current = null; }
    });
  };

  const filtered = lessons.filter(lesson =>
    (nav !== 'Documents' || lesson.kind === 'document') && (nav !== 'Whiteboards' || lesson.kind === 'whiteboard') &&
    (!folder || lesson.folder === folder) &&
    `${lesson.title} ${lesson.subject} ${lesson.topic} ${lesson.grade}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt));
  const folders = [...new Set(lessons.map(l => l.folder).filter(Boolean))].sort();
  const currentPage = active?.pages[index];
  const mainNav: { label: Nav; icon: typeof Home }[] = [
    { label: 'Home', icon: Home }, { label: 'My Lessons', icon: BookOpen },
    { label: 'Documents', icon: FileText }, { label: 'Whiteboards', icon: PenLine }, { label: 'Templates', icon: LayoutTemplate },
  ];

  return <div className={`app ${presenting ? 'presenting' : ''}`}>
    <input ref={fileInput} type="file" className="hidden-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.teacherstudio"
      aria-label="Import document or project" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void run('Importing and checking your document…', async () => enter(await importFile(file), true));
      }} />
    {!presenting && <aside className="sidebar">
      <button className="brand" onClick={() => navigate('Home')} aria-label="Teacher Studio home"><span className="brand-mark"><PenLine size={23} /></span><span>Teacher<span className="brand-light">Studio</span><small>YOUR TEACHING, REIMAGINED</small></span></button>
      <button className="new-lesson" onClick={() => { const lesson = newBoard(); void run('Creating lesson…', async () => { await enter(lesson, true); setModal({ type: 'metadata', lesson }); }); }}><Plus size={19} /> Create a lesson</button>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {mainNav.map(({ label, icon: Icon }) => <button key={label} className={!active && nav === label ? 'active' : ''} onClick={() => navigate(label)}><Icon size={19} /><span>{label}</span>{label === 'My Lessons' && <small>{lessons.length}</small>}</button>)}
      </nav>
      <div className="sidebar-divider" />
      <nav><button className={!active && nav === 'Recent Files' ? 'active' : ''} onClick={() => navigate('Recent Files')}><FolderOpen size={19} />Recent Files</button></nav>
      <div className="sidebar-bottom">
        <div className="offline-card"><span className="online-dot" /><div>Made for your classroom<small>Offline. Private. Always yours.</small></div></div>
        <nav><button onClick={() => navigate('Settings')} className={nav === 'Settings' && !active ? 'active' : ''}><Settings size={19} />Settings & help</button></nav>
        <div className="teacher-profile"><div>TS</div><span>My workspace<small>Local teacher account · No login</small></span></div>
      </div>
    </aside>}
    <main>
      {notice && <div role={notice.error ? 'alert' : 'status'} className={`notice ${notice.error ? 'error' : 'success'}`}><span>{notice.text}</span><IconButton label="Dismiss notification" onClick={() => setNotice(null)}><X size={17} /></IconButton></div>}
      {busy && <div className="busy" role="status"><span className="spinner" />{busy}</div>}
      {active && currentPage ? <>
        <header className="editor-header">
          <div className="editor-title"><IconButton label="Back to lessons" onClick={() => navigate('My Lessons')}><ArrowLeft size={19} /></IconButton><div><button onClick={() => setModal({ type: 'metadata', lesson: active })}>{active.title}</button><small className={saveStatus === 'Save failed' ? 'failed' : ''}>{saveStatus === 'Saved' && <Check size={12} />}{saveStatus} locally{active.subject && ` · ${active.subject}`}</small></div></div>
          <div className="header-actions"><IconButton label="Save project (Ctrl+S)" onClick={() => void run('Saving…', flush)}><ArrowDownToLine size={19} /></IconButton><button className="secondary-button" onClick={() => void run('Opening presentation mode…', togglePresentation)}><Presentation size={16} />{presenting ? 'Exit presentation' : 'Present'}</button><button className="primary-button" onClick={() => setModal({ type: 'export' })}><Download size={16} />Export<ChevronDown size={14} /></button></div>
        </header>
        <div className="drawing-toolbar" role="toolbar" aria-label="Drawing tools">
          <div className="tool-group">{tools.map(({ id, label, icon: Icon, shortcut }) => <IconButton key={id} label={`${label}${shortcut ? ` (${shortcut})` : ''}`} aria-pressed={tool === id} className={`icon-button ${tool === id ? 'chosen' : ''}`} onClick={() => setTool(id)}><Icon size={19} /></IconButton>)}</div>
          <div className="tool-group colors">{colors.map(c => <button key={c} className={`color-dot ${color === c ? 'chosen' : ''}`} style={{ background: c }} aria-label={`Ink ${c}`} aria-pressed={color === c} title={c} onClick={() => setColor(c)} />)}<input type="color" value={color} aria-label="Custom ink color" title="Custom ink color" onChange={e => setColor(e.target.value)} /></div>
          <label className="stroke-control" title="Stroke width in document units"><span>Size</span><input type="range" min="1" max="16" value={width} onChange={e => setWidth(Number(e.target.value))} aria-label="Stroke width" /><span>{width}</span></label>
          <label className="opacity-control" title="Ink opacity"><select aria-label="Ink opacity" value={opacity} onChange={e => setOpacity(Number(e.target.value))}><option value={1}>100%</option><option value={0.75}>75%</option><option value={0.5}>50%</option><option value={0.25}>25%</option></select></label>
          <div className="tool-group history-tools"><IconButton label="Undo (Ctrl+Z)" disabled={!pageHistory?.past.length} onClick={() => travel('undo')}><Undo2 size={19} /></IconButton><IconButton label="Redo (Ctrl+Y)" disabled={!pageHistory?.future.length} onClick={() => travel('redo')}><Redo2 size={19} /></IconButton></div>
        </div>
        <div className="editor-body">
          {showPages && !presenting && <aside className="page-panel"><div className="page-panel-heading">PAGES <IconButton label="Hide pages" onClick={() => setShowPages(false)}><PanelLeftClose size={16} /></IconButton></div><div className="thumbnail-list">{active.pages.map((page, i) => <Thumbnail key={page.id} doc={pdfDocument} page={page} index={i} active={i === index} onClick={() => { setIndex(i); setSelected(null); }} />)}</div>{active.kind === 'whiteboard' && <button className="add-page" onClick={() => {
            const page = { ...newBoard().pages[0], background: currentPage.background, pattern: currentPage.pattern };
            changePages([...active.pages, page]); setIndex(active.pages.length);
          }}><Plus size={15} />Add page</button>}</aside>}
          <Editor lesson={active} index={index} zoom={zoom} tool={tool} color={color} width={width} opacity={opacity}
            document={pdfDocument} selected={selected} onSelect={setSelected} onChange={changeAnnotations} onText={(point, annotation) => setModal({ type: 'text', point, annotation })} />
        </div>
        <footer className="editor-footer">
          <div><IconButton label={showPages ? 'Hide page thumbnails' : 'Show page thumbnails'} onClick={() => setShowPages(!showPages)}><Grid2X2 size={16} /></IconButton><IconButton label="Previous page" disabled={index === 0} onClick={() => setIndex(pageIndex(index, -1, active.pages.length))}><ChevronLeft size={17} /></IconButton><span>Page {index + 1} of {active.pages.length}</span><IconButton label="Next page" disabled={index === active.pages.length - 1} onClick={() => setIndex(pageIndex(index, 1, active.pages.length))}><ChevronRight size={17} /></IconButton></div>
          <div className="page-options">{active.kind === 'whiteboard' && <>
            <select aria-label="Paper color" value={currentPage.background} onChange={e => changePages(active.pages.map((p, i) => i === index ? { ...p, background: e.target.value } : p))}><option value="#ffffff">White paper</option><option value="#fff5ce">Yellow paper</option><option value="#17212b">Black paper</option></select>
            <select aria-label="Paper pattern" value={currentPage.pattern} onChange={e => { const pattern = e.target.value; if (pattern === 'plain' || pattern === 'dots' || pattern === 'grid') changePages(active.pages.map((p, i) => i === index ? { ...p, pattern } : p)); }}><option value="plain">Plain</option><option value="dots">Dotted</option><option value="grid">Grid</option></select>
          </>}<IconButton label="Delete selected object" disabled={!selected} onClick={removeSelected}><Trash2 size={16} /></IconButton><button className="text-button" onClick={() => { if (window.confirm('Clear every annotation on this page? You can undo this.')) { changeAnnotations([]); setSelected(null); } }}>Clear page</button></div>
          <div><IconButton label="Zoom out" onClick={() => changeZoom(zoom - 0.1)}><Minus size={16} /></IconButton><span className="zoom-label">{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" onClick={() => changeZoom(zoom + 0.1)}><Plus size={16} /></IconButton><IconButton label="Fit width" onClick={() => fit('width')}><Expand size={16} /></IconButton><IconButton label="Fit page" onClick={() => fit('page')}><Maximize size={16} /></IconButton></div>
        </footer>
      </> : <>
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{nav}</strong></div><div className="topbar-right"><span className="local-badge"><span className="online-dot" />All files stay on this device</span><button className="help-button" aria-label="Help and keyboard shortcuts" onClick={() => setModal({ type: 'help' })}>?</button><div className="avatar">TS</div></div></header>
        <div className="dashboard-scroll">
          {loading ? <div className="empty-state"><span className="spinner" />Opening your local library…</div> : loadFailed ? <div className="empty-state"><h2>Library needs attention</h2><p>Your existing files have not been replaced. Close other Teacher Studio windows, then reload. The error above has details.</p><button className="primary-button" onClick={() => location.reload()}>Retry loading</button></div> : nav === 'Settings' ? <section className="settings-page"><span className="eyebrow">YOUR LOCAL STUDIO</span><h1>Simple. Private. Yours.</h1><p>No accounts. No uploads. Your classroom stays with you.</p><div className="settings-card"><h2>Storage & backups</h2><p>Lessons and bundled source files are saved in this app’s local IndexedDB database. Each completed edit is also journaled for crash recovery. Export .teacherstudio projects regularly: clearing application/browser data or uninstalling may remove your library.</p><button className="secondary-button" onClick={() => { void run('Requesting persistent storage…', async () => { const granted = await navigator.storage?.persist?.(); setNotice({ text: granted ? 'Persistent storage granted.' : 'Persistent storage was not granted by this runtime. Keep exported project backups.', error: !granted }); }); }}>Protect local storage</button></div><div className="settings-card"><h2>Teaching with Google Meet</h2><p>Open your lesson, choose Present, then share the Teacher Studio window in Google Meet. Meet runs separately; there is no meeting control or student sync.</p></div><div className="settings-card"><h2>Import & export</h2><p>PDF, PNG, JPEG, WebP and editable .teacherstudio projects. PowerPoint conversion requires the desktop app and a local LibreOffice installation. Alternatively export your presentation to PDF in PowerPoint.</p><p>{isTauri() ? 'Desktop mode: native save dialogs and atomic export writes.' : 'Browser preview: files use browser downloads. Set your browser to ask where downloads are saved for destination control.'}</p><p>Teacher Studio 0.1.0 · Large paged whiteboards (1600 × 1000), not infinite canvases.</p></div><button className="secondary-button" onClick={() => setModal({ type: 'help' })}>Keyboard shortcuts & help</button></section> : <>
            {nav === 'Home' ? <>
              <section className="welcome"><div><div className="eyebrow"><span className="tiny-line" /> A LITTLE PREPARATION. A LOT OF POSSIBILITY.</div><h1>Great lessons start here<span>.</span></h1><p>Your ideas, your notes, your next lightbulb moment. All in one place.</p></div><div className="date-card"><span>YOUR WORKSPACE</span><strong>Ready when you are</strong><small><span className="online-dot" />Working offline, by design</small></div></section>
              <section className="hero"><div className="hero-content"><span className="hero-kicker"><Sparkles size={14} /> MORE SPACE TO EXPLAIN</span><h2>Turn “I don’t get it”<br />into “Oh, I see.”</h2><p>Sketch an idea. Bring a document to life.<br />Make your next lesson a little more memorable.</p><button className="light-button" onClick={() => createBoard()}><Plus size={17} />Start a whiteboard<ArrowUpRight size={17} /></button></div><div className="hero-art" aria-hidden="true"><div className="art-dots" /><div className="art-page"><div className="art-tag">TODAY’S BIG IDEA</div><div className="art-title">Keep it simple.</div><svg viewBox="0 0 310 140"><path d="M25 35 C90 0 100 130 175 70 S250 15 280 60" fill="none" stroke="#0d9488" strokeWidth="4" strokeLinecap="round" /><rect x="22" y="90" width="72" height="35" rx="8" fill="#e1f3ed" /><path d="M110 107 H180 M170 98 L181 107 L170 116" fill="none" stroke="#e78c4a" strokeWidth="3" /><rect x="200" y="90" width="84" height="35" rx="8" fill="#fff0db" /></svg><div className="art-lines"><i /><i /><i /></div></div><div className="art-pen"><PenLine size={22} /></div><div className="floating-label"><span>✦</span> Aha! moments, made here.</div></div></section>
              <section className="quick-actions" aria-label="Quick actions">
                <button onClick={() => createBoard()}><span className="action-icon teal"><PenLine /></span><span><strong>New whiteboard</strong><small>A blank canvas. Endless ideas.</small></span><ArrowUpRight size={17} /></button>
                <button onClick={() => fileInput.current?.click()}><span className="action-icon orange"><FileText /></span><span><strong>Open PDF</strong><small>Read, highlight, explain.</small></span><ArrowUpRight size={17} /></button>
                <button onClick={() => void run('Preparing presentation import…', async () => { const lesson = await importPresentation(); if (lesson) await enter(lesson, true); })}><span className="action-icon purple"><Presentation /></span><span><strong>Import presentation</strong><small>Bring your slides to life.</small></span><ArrowUpRight size={17} /></button>
              </section>
            </> : <section className="page-heading"><span className="eyebrow">YOUR TEACHING TOOLKIT</span><h1>{nav}</h1><p>{nav === 'Templates' ? 'Skip the blank page. Start with a little structure.' : 'Pick up where you left off, or make room for something new.'}</p></section>}
            {nav !== 'Templates' && <section className="library-section">
              <div className="section-heading"><div><h2>{nav === 'Home' ? 'Pick up where you left off' : nav === 'Recent Files' ? 'Recently opened & edited' : 'Your library'}</h2><p>{nav === 'Home' ? 'Your recent lessons, right where you need them.' : `${filtered.length} saved lesson${filtered.length === 1 ? '' : 's'} · Stored on this device`}</p></div>{nav === 'Home' ? <button className="text-button" onClick={() => navigate('My Lessons')}>View all lessons<ArrowRight size={15} /></button> : <button className="primary-button" onClick={() => fileInput.current?.click()}><Plus size={16} />Import file</button>}</div>
              <div className="library-filters"><label className="search-field"><Search size={16} /><input placeholder="Search your lessons…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search lessons" /><kbd>⌕</kbd></label><div><select aria-label="Filter by folder" value={folder} onChange={e => setFolder(e.target.value)}><option value="">All folders</option>{folders.map(f => <option key={f}>{f}</option>)}</select><select aria-label="Sort lessons" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Last edited</option><option value="name">Name A–Z</option></select></div></div>
              {filtered.length ? <div className="lesson-grid">{filtered.slice(0, nav === 'Home' ? 4 : filtered.length).map(lesson => <article className="lesson-card" key={lesson.id}>
                <button className="lesson-open" aria-label={`Open ${lesson.title}`} onClick={() => void run('Opening lesson…', () => enter(lesson))}><Preview lesson={lesson} /><div className="lesson-card-body"><h3>{lesson.title}</h3><span>{lesson.subject || (lesson.kind === 'whiteboard' ? 'Whiteboard' : 'Document')}{lesson.folder ? ` · ${lesson.folder}` : ''}</span></div></button>
                <div className="lesson-card-footer"><span>{new Date(lesson.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {lesson.pages.length} {lesson.pages.length === 1 ? 'page' : 'pages'}</span><details className="card-menu"><summary title={`Actions for ${lesson.title}`} aria-label={`Actions for ${lesson.title}`}><MoreHorizontal size={18} /></summary><div><button onClick={() => setModal({ type: 'metadata', lesson })}>Rename & organize</button><button onClick={() => duplicate(lesson)}><Copy size={14} />Duplicate</button><button onClick={() => remove(lesson)}><Trash2 size={14} />Delete</button></div></details></div>
              </article>)}</div> : <div className="empty-state"><div className="empty-icon"><BookOpen size={30} /></div><h3>{query || folder ? 'No lessons found' : 'Your next great lesson belongs here'}</h3><p>{query || folder ? 'Try another name or folder.' : 'Open a document or start a whiteboard. We’ll keep your work safe as you go.'}</p><button className="secondary-button" onClick={() => fileInput.current?.click()}><FolderOpen size={16} />Open a file</button></div>}
            </section>}
            {(nav === 'Home' || nav === 'Templates') && <section className="template-section"><div className="section-heading"><div><h2>A head start for your next lesson</h2><p>A little structure. A lot of room to make it yours.</p></div>{nav === 'Home' && <button className="text-button" onClick={() => navigate('Templates')}>Explore templates<ArrowRight size={15} /></button>}</div><div className="template-grid">{templates.slice(0, nav === 'Home' ? 4 : templates.length).map(template => <button className={`template-card template-${template.id}`} key={template.id} onClick={() => createBoard(template.id)}><div className="template-paper"><svg viewBox="0 0 1600 1000"><Background page={newBoard(template.id).pages[0]} id={`template-${template.id}`} />{newBoard(template.id).pages[0].annotations.map(a => <AnnotationObject key={a.id} annotation={a} />)}</svg>{['blank', 'dots', 'grid'].includes(template.id) && <PenLine size={28} strokeWidth={1.2} />}</div><strong>{template.label}</strong><small>{template.caption}</small></button>)}</div></section>}
            <div className="dashboard-footnote"><span><span className="online-dot" />No cloud. No distractions. Just good teaching.</span><button className="text-button" onClick={() => setModal({ type: 'help' })}>Made for your everyday classroom<ArrowUpRight size={13} /></button></div>
          </>}
        </div>
      </>}
    </main>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onKeyDown={e => {
        if (e.key === 'Escape' && !busy) setModal(null);
        if (e.key === 'Tab') {
          const items = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea,a[href]');
          const first = items[0], last = items[items.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
        <IconButton label="Close dialog" disabled={!!busy} onClick={() => setModal(null)}><X size={19} /></IconButton>
        {modal.type === 'metadata' && <form onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          const updated = { ...modal.lesson, title: String(data.get('title')).trim() || 'Untitled lesson', subject: String(data.get('subject')), grade: String(data.get('grade')), topic: String(data.get('topic')), folder: String(data.get('folder')), updatedAt: new Date().toISOString() };
          void run('Saving lesson details…', async () => {
            if (active?.id === updated.id) updateLesson({ ...active, ...updated, pages: active.pages });
            else { await saveLesson(updated); setLessons(list => list.map(item => item.id === updated.id ? updated : item)); }
            setModal(null);
          });
        }}><span className="eyebrow">MAKE IT YOURS</span><h2 id="modal-title">Lesson details</h2><p>A good name makes a great lesson easy to find.</p><label>Lesson title<input autoFocus name="title" defaultValue={modal.lesson.title} maxLength={200} required /></label><div className="form-row"><label>Subject<input name="subject" defaultValue={modal.lesson.subject} maxLength={200} placeholder="Computer Science" /></label><label>Class / grade<input name="grade" defaultValue={modal.lesson.grade} maxLength={100} placeholder="Class 10" /></label></div><label>Chapter / topic<input name="topic" defaultValue={modal.lesson.topic} maxLength={200} /></label><label>Folder<input name="folder" list="folders" defaultValue={modal.lesson.folder} maxLength={100} placeholder="Type a folder name" /><datalist id="folders">{folders.map(f => <option key={f} value={f} />)}</datalist></label><button className="primary-button" disabled={!!busy} type="submit"><Check size={16} />Save details</button></form>}
        {modal.type === 'text' && active && <form onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget), text = String(data.get('text'));
          if (!text.trim()) return;
          const annotation: Annotation = { id: modal.annotation?.id ?? crypto.randomUUID(), type: 'text', points: modal.annotation?.points ?? [modal.point], text, fontSize: Number(data.get('fontSize')), color: modal.annotation?.color ?? color, width: 1, opacity };
          const objects = active.pages[index].annotations;
          changeAnnotations(modal.annotation ? objects.map(a => a.id === annotation.id ? annotation : a) : [...objects, annotation]); setModal(null);
        }}><h2 id="modal-title">{modal.annotation ? 'Edit text' : 'Add a text box'}</h2><label>Your text<textarea autoFocus name="text" defaultValue={modal.annotation?.text ?? ''} required maxLength={10000} rows={5} /></label><label>Font size<input name="fontSize" type="number" defaultValue={modal.annotation?.fontSize ?? 28} min={8} max={200} required /></label><button className="primary-button" type="submit">Place text</button></form>}
        {modal.type === 'export' && active && <ExportForm lesson={active} index={index} busy={!!busy} onSubmit={(format, filename, allPages, annotations) => {
          void run('Preparing your export…', async () => {
            const bytes = format === 'teacherstudio' ? new TextEncoder().encode(serializeProject(active)) : format === 'pdf'
              ? await exportPdf(active, { allPages, pageIndex: index, annotations })
              : await canvasPng(await compositePage(active, index, annotations));
            const completed = await saveExport(bytes, `${filename}.${format}`, format);
            if (completed) { setNotice({ text: isTauri() ? 'Export saved successfully.' : 'Export prepared and handed to your browser downloads.', error: false }); setModal(null); }
          });
        }} />}
        {modal.type === 'help' && <div className="help-content"><h2 id="modal-title">A smoother teaching flow</h2><p>Open a lesson → Present → share this window in Google Meet.</p><dl>{[['Ctrl + O', 'Open document / project'], ['Ctrl + S', 'Save locally'], ['Ctrl + Shift + S', 'Export a copy'], ['Ctrl + Z / Ctrl + Y', 'Undo / redo'], ['Ctrl + + / −', 'Zoom'], ['Page Up / Down', 'Navigate pages'], ['P / M / E / T', 'Pen / highlighter / eraser / text'], ['V / H / L', 'Select / pan / laser pointer'], ['Delete', 'Remove selected object'], ['F / Escape', 'Full screen / exit temporary mode']].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p>Use Select to move objects; drag the lower-right handle to resize. In PDFs, drag on empty text to select original text, or click ink to select annotations. Text tool edits an existing text box. Eraser removes whole objects; Undo restores them.</p><p>Projects bundle the original source and editable annotations. Export projects for portable backups. The original source is never overwritten by default.</p><button autoFocus className="primary-button" onClick={() => setModal(null)}>Got it</button></div>}
      </section>
    </div>}
  </div>;
}

function ExportForm({ lesson, index, busy, onSubmit }: { lesson: Lesson; index: number; busy: boolean; onSubmit(format: string, filename: string, allPages: boolean, annotations: boolean): void }) {
  const [format, setFormat] = useState('pdf');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const filename = Array.from(String(data.get('filename')).trim(), c => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c).join('').replace(/[. ]+$/, '');
    if (!filename) return;
    onSubmit(format, filename, data.get('pages') === 'all', data.get('annotations') === 'on');
  };
  return <form onSubmit={submit}><span className="eyebrow">READY TO SHARE</span><h2 id="modal-title">Take your lesson with you</h2><p>Keep an editable copy, or share a finished set of notes.</p><label>File name<input autoFocus name="filename" defaultValue={`${lesson.title} - copy`} required maxLength={150} /></label><label>Format<select name="format" value={format} onChange={e => setFormat(e.target.value)}><option value="pdf">PDF document</option><option value="png">PNG image · current page</option><option value="teacherstudio">Teacher Studio · editable project</option></select></label>{format !== 'teacherstudio' && <><label>Pages<select name="pages" defaultValue="all" disabled={format === 'png'}><option value="all">All {lesson.pages.length} pages</option><option value="current">Current page ({index + 1})</option></select></label><label className="checkbox-label"><input type="checkbox" name="annotations" defaultChecked />Include annotations</label></>}<div className="export-note">{format === 'teacherstudio' ? 'Versioned project with bundled source, paper settings and fully editable objects. All pages are always included.' : format === 'pdf' ? 'Original PDF pages are retained. Annotations are composited as a transparent high-resolution overlay; original PDF text stays selectable.' : 'The current page, at up to 2× resolution (16 megapixel safety cap).'}<br />{isTauri() ? 'Choose the destination in the next dialog. Export writes are atomic.' : 'Your browser controls the download destination. Enable “Ask where to save” in browser settings to choose a folder.'}</div><button className="primary-button" disabled={busy} type="submit"><Download size={16} />{busy ? 'Exporting…' : 'Export a copy'}</button></form>;
}
