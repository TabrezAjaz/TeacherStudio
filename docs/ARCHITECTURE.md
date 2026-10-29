# Architecture

## Components and boundaries

```
React application
  App                  library, active lesson, save queue, dialogs, shortcuts
  Editor               pointer gestures and transient object previews
  Annotations          shared SVG display/export primitives
  PdfPage              bounded-resolution PDF canvas and selectable text layer
  model / geometry     versioned schema and page-coordinate transforms
  history              immutable, bounded snapshots
  storage              IndexedDB transactions and per-lesson recovery journals
  pdf                  document adapters, source inspection and PDF.js lifecycle
  export               PDF page copy + annotation overlay, PNG composition
  platform             browser download / Tauri command boundary

Tauri 2 / Rust
  save_export          native user-selected destination and atomic write
  convert_presentation native user-selected input and local LibreOffice
```

React/TypeScript with Vite and ordinary CSS keeps the frontend build simple. A custom SVG object model uses `perfect-freehand` for smoothed pressure outlines. A large general-purpose canvas editor was not added: SVG primitives give explicit serialization, hit-testing, page geometry and exactly shared display/export rendering without a proprietary scene format. PDF.js renders original pages and selectable text; pdf-lib copies original PDF pages into exports without rasterizing their content.

`documentAdapters` is an extension registry: every adapter supplies extensions, source kind and asynchronous dimension inspection. PDF and raster-image adapters share the import and project source-validation pipeline. PowerPoint conversion returns an ordinary PDF to this pipeline rather than creating a second annotation engine. Additional formats need an adapter/schema change and tests, not custom drawing logic.

## Coordinate and interaction model

Each page has stable width/height in PDF.js scale-1 viewport units or image/whiteboard units. Pointer positions are transformed from the actual SVG client rectangle into that coordinate system. Screen zoom changes only the rendered page size. PDF rotation, CropBox and UserUnit are incorporated in PDF.js viewport inspection.

An annotation stores an ID, tool type, page-relative points (including pressure), stroke color/size, opacity, and optional text/font size. Page membership comes from the containing page record. A gesture uses pointer capture and a transient preview. Its owning pointer ID is checked on move/up/cancel/lost-capture events so a primary touch or mouse cannot overwrite an active pen gesture. Pen contact takes priority over an unfinished touch/mouse preview, discarding that preview rather than adding stray palm ink. A fresh primary contact of the same pointer type finishes a stale gesture before starting another, including when a driver changes pointer IDs without delivering the previous up event. This is input isolation, not certified hardware palm rejection.

The original dispatched move is always sampled in addition to any coalesced samples: an empty `getCoalescedEvents()` result must not discard motion. The final pen-up position is included. Draft samples live in refs; visible preview updates are scheduled at most once per animation frame and pending samples are committed directly on termination, even before that frame runs.

Pen-up, lost capture, pointer cancellation, window blur, a hidden document or hover with no tip button pressed finish the sampled ink once and release ownership; a late terminal event cannot duplicate it. Blur/visibility handling covers returning from another window/tab, but physical driver reconnection and browser/OS-specific pen behaviour still need real-device testing. Switching page/tool or zoom cancels an in-progress preview to avoid mixing coordinate systems; already committed ink is unaffected. Completed and interruption-finished gestures enter history/autosave. There is still no guarantee for a process crash before a gesture reaches one of those boundaries.

SVG object bounds support moving, whole-object hit-testing and bottom-right resize. Text bounds are estimated for selection; export text is rendered by the browser's real font rasterizer. Text remains editable in projects, but is flattened in shared PDF/PNG exports.

The editor uses explicit visual layers inside the paper's isolated stacking context: paper background at 0, positioned PDF canvas/image source at 1, selectable PDF text at 2 and editable SVG annotations at 3. Source layers do not intercept pointer events. This ordering is essential: a positioned opaque background can otherwise paint over an unpositioned PDF canvas even when the canvas appears later in the DOM. Screenshot-pixel tests verify the actual composited workspace, not merely canvas/text-layer existence or exported pixels.

## Saving and recovery

- IndexedDB database `teacher-studio`, version 1, object store `lessons`, key `id`.
- LocalStorage recovery key `teacher-studio:recovery:<lesson-id>`, containing lesson metadata/pages but not the potentially large source payload.
- Every completed edit receives a monotonic timestamp and synchronously writes its recovery entry before updating application state.
- After 450 ms without changes, a serial promise queue writes the full lesson in an atomic IndexedDB transaction.
- A completed transaction removes its recovery entry only if that entry's revision timestamp still matches. Older in-flight writes cannot delete a newer edit's journal.
- Library load validates saved records and merges a journal whose timestamp is at least as new. Corrupt records/recovery cause a visible error; the library is not silently reset.
- Switching lessons waits for pending saves. Failed saves leave the active lesson and recovery data available for export.
- Sources are embedded base64 so external file movement cannot break annotations. Recovery alone is insufficient if an original lesson record was removed; initial lesson creation is persisted before editing is enabled.

The browser's storage transaction guarantees do not replace file backups. Storage denial/quota errors are surfaced. Crash recovery applies to completed gestures, not partially drawn strokes. Undo history is intentionally session-local and capped at 50 snapshots.

## Export

For a PDF source, pdf-lib copies the requested original pages with their native sizes, rotations and crop boxes. The shared SVG annotation tree is rasterized over transparent pixels. Each overlay is embedded with a transform derived from the PDF page's crop origin and rotation (0/90/180/270). This retains original text/images and correctly maps top-left document coordinates to PDF coordinates. Tests reopen exports and inspect pixels/text, not merely file existence.

Whiteboards and image sources use the same SVG tree plus paper/background image. Current-page PNG can include or omit ink. Rendering is capped at 16 million pixels and 8192 pixels per side to avoid unbounded canvas allocations. Pages export sequentially, not all rendered in parallel.

PDF.js workers, CMaps, standard fonts and WASM are copied to local assets by the build/dev scripts. The worker is served as a static asset, avoiding Vite's development-module transformations inside a PDF worker.

## Native boundary

No filesystem or shell plugins are granted. A native save command can write only to a path chosen in its own save dialog; the renderer never submits a filesystem destination. It writes a named temporary file in the same directory, flushes it, then persists it over the explicitly selected destination.

Conversion picks a PPT/PPTX using a native dialog, checks file size/extension, copies it into an isolated temporary directory, invokes a known standard-installation LibreOffice binary with argument arrays (no shell), an isolated profile URL and a 90-second timeout, then checks the PDF header/size. Original input is never edited. Font/animation fidelity is not certified. Office files can contain complex active content: use trusted files and keep LibreOffice current; the converter is not an OS sandbox.

Rust dependencies are declared but not resolved/built in this environment. Native behavior must be validated on a suitably provisioned Windows machine.

## Deliberate first-release tradeoffs

- Paged large canvases instead of infinite coordinates.
- Raster annotation overlays instead of implementing every PDF-native ink/text/font operation.
- Local IndexedDB plus recovery instead of an untested native database bridge.
- Bundled sources instead of fragile external path associations.
- No internet services, automatic conferencing integration or user authentication.
- A library loads full records initially; separate source-blob storage and metadata pagination are future optimizations.
