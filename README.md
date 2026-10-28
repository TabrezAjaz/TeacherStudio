# Teacher Studio

A local-first teaching workspace for Windows: annotate PDFs, draw on large whiteboards, organize lessons, and export notes without accounts or cloud services.

**Status:** working, tested React application with a Tauri 2 desktop shell. The frontend and browser acceptance workflows have been verified on Windows with Microsoft Edge. **The Rust shell, Windows installer, native save dialogs, and LibreOffice conversion have not been built or executed in the development environment**, which lacks Rust, MSVC Build Tools and LibreOffice. This is not a certified production release.

## Run locally

Requires Node.js 22.12+ (tested with Node 24.14.0) and npm.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:1420`. The development script copies PDF.js workers, fonts, CMaps and WASM locally; no CDN is needed. Browser preview uses browser downloads rather than native save dialogs. Enable your browser's “Ask where to save each file” setting to choose destinations.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

The acceptance suite uses installed Microsoft Edge through Playwright, so no additional browser download is needed on Windows. The production frontend is generated in `dist`. `npm run preview -- --port 1420` serves that build for local verification. Do not double-click the built HTML: it needs an HTTP origin or the Tauri asset protocol.

## Windows desktop build

Install these prerequisites separately:

1. Rust stable using rustup, with the MSVC host toolchain.
2. Visual Studio 2022 Build Tools: **Desktop development with C++**, the MSVC compiler and a Windows SDK.
3. Microsoft Edge WebView2 Runtime (already present on many Windows machines).
4. Optional: LibreOffice in its standard Program Files installation directory for local PPT/PPTX conversion.

```powershell
npm ci
npm run tauri -- info
npm run tauri -- dev
npm run tauri -- build
```

The configured NSIS installer is generated under `src-tauri\target\release\bundle\nsis`. Test it on a separate Windows user profile before distributing it. WebView2 bootstrapping may require an internet connection during installation if WebView2 is missing; supported document/whiteboard workflows do not require internet at runtime. Unsigned builds may trigger SmartScreen warnings. No installer is included or claimed to have been tested.

## Implemented

- Dashboard, lesson library, documents, whiteboards, recent activity, templates and settings.
- PDF import with page thumbnails (rendered only near the thumbnail viewport), single-page lazy rendering, navigation, scroll/pan, zoom, fit width/page and selectable original text.
- PNG, JPEG and WebP teaching backgrounds; signature, size and image-dimension checks.
- Smooth pressure-sensitive ink using perfect-freehand; mouse, primary touch and pen pointer events; highlighter, whole-object eraser, text, lines, arrows, rectangles and ellipses.
- Object selection, movement, lower-right resize handle, Delete, bounded undo/redo and clear-page confirmation.
- Temporary laser pointer and full-screen teaching mode for external Google Meet window sharing.
- Stable page-relative coordinates, including mixed orientations and rotated/cropped PDFs.
- White/yellow/black paper with plain/dotted/grid patterns; multiple large whiteboard pages.
- Seven editable templates: blank, dots, grid, flowchart, mind map, brainstorming and code explanation.
- Lesson naming, subject, grade, topic, folders, search, sorting, duplication and confirmed deletion.
- Transactional IndexedDB saves with 450 ms debounce, synchronous recovery journals for completed edits, save/error indicators and flush before switching lessons.
- Original-preserving annotated PDF export, all/current-page selection, annotation inclusion toggle, whiteboard PDF and current-page PNG.
- Versioned `.teacherstudio` export/import with bundled sources and fully editable objects.
- Native atomic export implementation and optional local PowerPoint-to-PDF conversion implementation in Rust, **pending native validation**.

## A practical lesson

1. Choose **Open PDF**, select a file and navigate with thumbnails or Page Up/Down.
2. Write with **Pen**, explain with **Highlighter**, or add text, arrows and shapes.
3. Choose **Select** to drag an annotation or resize it with its lower-right handle. The text tool edits existing text boxes. On a PDF, drag over original text away from annotations to select it.
4. Work is saved automatically. Ctrl+S explicitly flushes the local save.
5. Choose **Present**, then share the application window in Google Meet separately.
6. Export a PDF to share, and an editable project for portable backup.

Shortcuts and tool descriptions are available from the `?` button.

## Data integrity and privacy

All document processing and storage stay on this device. No telemetry, remote fonts, cloud storage or document uploads are implemented. The Tauri shell exposes only two purpose-specific native commands; it has no generic shell or filesystem plugin.

The original PDF is bundled rather than referenced by path, so moving/deleting the external original does not break saved lessons. Export defaults to a `- copy` name. PDF exports copy original PDF pages and overlay only annotations as transparent PNGs; original PDF text/images are not screenshots. Whiteboard/image pages are composited at up to 2× resolution, subject to a 16-megapixel and 8192-pixel-side safety cap.

**Keep exported project backups.** IndexedDB/localStorage are local application data, not a backup system. Clearing browser/app data, storage eviction or uninstalling can remove them. Browser preview and desktop use different origins and do not automatically share libraries; transfer projects between them.

Storage failure is shown explicitly. A recovery-journal failure means the newest edit may only survive if its queued IndexedDB write succeeds: export a project immediately. An in-progress gesture that has not finished is not guaranteed to survive a crash.

## Current limitations

- Windows packaging and all native functionality need testing after prerequisites are installed.
- PowerPoint requires local LibreOffice in the desktop app; the browser provides clear instructions to export PDF in PowerPoint instead. Animations, videos, embedded objects, fonts and complex formatting are not guaranteed. No native PPTX editing/export is claimed.
- Large **paged** whiteboards, not an infinite canvas. No partial-stroke erasing, arbitrary selection-area export, free rotation, grouping, in-canvas image placement, Word conversion or collaboration.
- Related boards can be organized in the same folder; there is no explicit cross-lesson relationship field.
- Only the current PDF page is displayed at a time; scrolling pans that page rather than continuously scrolling the entire document.
- Annotations in exported PDFs are flattened, not PDF-native editable markup. Use editable projects to continue editing. PDF forms, links, signatures, accessibility structure and advanced document features are not certified; exporting invalidates digital signatures.
- Password-protected PDFs have no password-entry UI and report an import error.
- The library currently loads bundled sources with lesson records; many large lessons increase startup memory. History is capped at 50 edits. Source files are limited to 75 MB, projects to 150 MB, and documents to 2,000 pages.
- There is no migration from earlier project schemas yet. Schema 1 is the initial version; unknown versions are rejected explicitly rather than guessed or silently modified.
- Browser downloads report handoff to the browser, not proof of disk persistence; native exports synchronize and atomically replace the selected target.
- Real stylus hardware, touchscreen palm rejection, long-running memory behavior and install/uninstall recovery need physical-device testing.

See [architecture](docs/ARCHITECTURE.md), [project format](docs/PROJECT-FORMAT.md), [validation and acceptance](docs/VALIDATION.md), and [dependency/license notes](docs/DEPENDENCIES.md).
