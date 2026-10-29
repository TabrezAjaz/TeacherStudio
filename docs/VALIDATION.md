# Validation and acceptance

## Verified environment

Windows x64, Node 24.14.0, installed Microsoft Edge/WebView2 156. The frontend has been typechecked, linted and built. Unit tests use Vitest, jsdom, Testing Library and fake-indexeddb. Integration tests drive an actual Edge browser with Playwright.

Native prerequisites are absent: Rust/Cargo, MSVC C++ Build Tools and LibreOffice. Consequently no native binary, installer, native filesystem permission/disk-space test or PowerPoint conversion success is certified.

Final verified results (2026-10-28):

| Check | Result |
|---|---|
| Strict TypeScript / production build | Passed |
| ESLint | Passed |
| Vitest | 18 tests passed across 4 files |
| Edge development acceptance | 6 tests passed |
| Edge built-production acceptance | 6 tests passed, including visible PDF/image composition regression |
| npm audit | 0 known advisories |
| Independent Edge PDF viewer | Export opened and visually inspected |
| Native executable / installer / LibreOffice | Blocked by missing system prerequisites |

Build warnings remain for the large combined JavaScript chunk and two nonfunctional third-party PURE-comment annotations. They do not prevent compilation. Splitting PDF/editor dependencies is a future launch-performance optimization, not a measured improvement.

## Automated coverage

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm audit
```

To repeat the shipped-bundle checks after building:

```powershell
$env:STUDIO_PREVIEW = '1'
npm run test:e2e -- --grep-invert 'multi-page PDF'
Remove-Item Env:\STUDIO_PREVIEW
```

The excluded development-only test dynamically imports the source PDF inspection helper to perform deep export pixel assertions. The other seven tests run against the actual production assets, including visible document/ink screenshot pixels, a separate PDF import/annotate/export/reopen workflow and the sustained simulated-pen session, with no source-module imports.

### On-screen PDF visibility regression (2026-10-28)

A user-reported blank main document, despite a correct PDF export, exposed a gap in earlier checks: the canvas held the right pixels but an opaque positioned paper background covered it in the displayed page. A new screenshot-based assertion failed on the old build (expected blue source content, observed white), then passed after explicit source/background stacking was applied. It checks source pixels and annotation pixels together through tool changes, zoom, navigation, resize and reopening. The existing image-background workflow now also verifies the displayed pixels. The user's already-open local PDF was visually checked after loading the corrected CSS without reloading or replacing their work.

Unit suite covers:

- Coordinate mapping at different zooms/offsets and pointer pressure.
- Hit tests, immutable move/resize, bounded undo/redo and redo invalidation.
- Editable template construction and versioned project round-trips.
- Corrupt/unsupported schemas, duplicate identities, invalid base64 and missing sources.
- Clamped PDF page navigation.
- Save/reload, source independence, interrupted-save recovery, stale-save races, denied recovery storage, failed atomic transaction and deletion.
- Shared SVG ink/paper rendering and safe text escaping.

Browser suite covers:

- Real mouse handwriting, text placement, undo/redo and grid-paper editing.
- Save/reload, editable project export/import, whiteboard PDF page dimensions and PNG signature/pixel dimensions.
- Mixed portrait/landscape PDF navigation and five-page annotated PDF export.
- Original PDF text extraction and unchanged sizes/crop boxes/rotations.
- Pixel inspection of red rectangle alignment and green annotation text on 0°, 90°, 180° and 270° pages, including a nonzero CropBox.
- Current-page/all-page export and the “omit annotations” option.
- Invalid/empty PDFs and honest browser presentation fallback.
- Object selection, movement, resize, deletion, whole-object erasing, undo and zoom invariance.
- Image backgrounds and PDF size preservation, metadata, folders, search and duplication.
- A network allowlist that rejects non-local requests, confirming the tested workflows do not request external services.
- Actual workspace screenshot pixels: original PDF content remains visible beneath ink through drawing, tool changes, zoom, page navigation, window resizing and save/reopen. The regression test reproduces the former white-background occlusion before the layer fix; image backgrounds are also checked in the visible composition.

The suite generates its own original PDF inputs. Maintained fixtures are also included:

- [Three-page PDF](../tests/fixtures/multi-page.pdf).
- [Mixed-orientation PDF](../tests/fixtures/mixed-orientations.pdf).
- [Editable board with ink, shape and text](../tests/fixtures/editable-whiteboard.teacherstudio).
- [Three-slide PowerPoint fixture](../tests/fixtures/three-slides.pptx) — generated OOXML fixture, conversion/rendering not yet certified.

Regenerate PDFs/board with `node scripts\fixtures.mjs`, then the presentation with `.\scripts\presentation-fixture.ps1`.

## Independent PDF viewer check

The export test retains original and annotated mixed-page PDFs in its `test-results` subdirectory. The annotated export was opened separately in Edge's built-in PDF viewer (not the application's PDF.js canvas). Visual inspection confirmed the displayed five-page count, original blue source rectangle/text and correctly placed red rectangle/arrow, green text and translucent yellow highlight on the first page. Exact dimensions and all rotation/crop alignments are additionally checked programmatically by pdf-lib and PDF.js. This is not a blanket certification of all PDF features.

## Native release gate — still required

1. Install Rust stable/MSVC prerequisites and LibreOffice.
2. Run `npm run tauri -- info`, then build and test both debug and release applications.
3. Install the NSIS bundle into a clean Windows profile. Confirm first launch, relaunch, shortcut, uninstall behavior and WebView2 bootstrap behavior.
4. Import the mixed fixture and repeat every browser editing/export workflow in WebView2.
5. Close the app immediately after a completed stroke; relaunch and confirm recovery.
6. Attempt native export into a read-only folder, simulate insufficient space, cancel the dialog, and explicitly overwrite an existing export. Confirm errors/cancellation leave originals unchanged and no partial target replaces a valid previous export.
7. Test touchscreen/stylus input and pressure with real hardware.
8. Disconnect the network and repeat supported PDF/whiteboard/project workflows.
9. Test signed/encrypted/form-heavy, CJK, image-heavy and long real teaching documents; measure startup, memory and stroke latency rather than extrapolating from small fixtures.

## PowerPoint acceptance — not passed yet

Do not mark presentation support complete until this passes on the desktop build:

1. Open the three-slide fixture in an independent presentation viewer; confirm slide order/text/layout.
2. Import it through the native conversion dialog; confirm three PDF-backed pages in the same order.
3. Compare layout/text/images against the independent viewer. Confirm clear limitations for animations, embedded media, unsupported fonts and complex objects.
4. Draw different annotations on each slide, save, close, reopen and verify stable association.
5. Export all annotated slides to PDF and inspect in an independent PDF viewer.
6. Compare the source file hash before/after; it must be identical.
7. Repeat with a representative legacy PPT and a real PPTX with images and varied fonts.
8. Test missing LibreOffice, locked input, corrupt content, very large input, timeout, cancellation and output/disk permission failures. The browser fallback must continue to direct users to local PowerPoint PDF export.

## Performance and scope

No startup, throughput or latency benchmark is claimed. Development test timings vary with system load and are not user-facing performance measurements. Rendering is bounded to one full page and visible thumbnail previews; export is sequential and canvas sizes/history are bounded. The full-record library still needs measurement and possible metadata/source separation for many large lessons.

## Stylus continuity follow-up (2026-10-29)

Real-device testing reported intermittent handwriting failure even though the tablet continued working in Paint. The original automated acceptance focused on short mouse gestures and did not certify sustained tablet input. The supplied photo and the currently shared library screen do not establish which event sequence occurred during that failure; no specific VEIKK driver diagnosis is claimed.

The following input defects were reproduced in new component tests before changing the handler:

- Empty coalesced-event batches discarded move samples instead of using the dispatched event.
- Gestures had no owning pointer ID, allowing another primary touch to replace or cancel pen work.
- Lost capture, window blur, hidden-document transitions and missing up events lacked coordinated cleanup.
- Pen-up could omit its final coordinates; previews were tied to raw move-event frequency rather than animation frames.

The initial eight regressions failed on the previous handler. The expanded suite adds pressure-batch deduplication, dense-move frame scheduling, replacement pointer IDs and pen priority over an unfinished touch. Interrupted sampled ink is now committed once on blur/cancel/lost capture/no-button hover; page/tool/zoom switches still cancel an in-progress preview to avoid mixed coordinates. Draft refs, rather than a potentially stale React preview render, supply committed samples.

A separate Edge/CDP test dispatches **400 pressure-varying pen strokes**, waits for autosaves, changes window focus, enters/exits actual full screen, navigates pages and changes zoom. It exports the editable project and checks every stroke/sample/pressure range, reloads the lesson, then draws a 401st stroke. This uses browser-generated `pointerType: pen` input; it is **not physical tablet certification**, a multi-hour soak, or a handwriting-latency benchmark.

Follow-up verified results: strict TypeScript, production build and ESLint passed; **30 unit/component tests across 5 files passed**, including 12 editor-input cases. All **7 production-browser workflows passed across the final regression and targeted rerun**. The first regression attempt exceeded a 5-second asynchronous invalid-file alert wait and a 240-second pen-test budget; these were not input-count assertion failures. The rerun passed both tests after allowing worker-error latency and reducing test-driver overhead (cached canvas bounds per batch, three pressure moves plus endpoints per stroke). The 401-stroke test completed in approximately 2.3 minutes; this is test-run duration, not a latency benchmark.

Physical retest gate: keep an exported project backup, load the updated build, repeat a real teaching session with the same VEIKK/Windows Ink settings and check behaviour after Alt+Tab, full-screen changes and repeated pen lifts. If the symptom remains, capture the failing event sequence and browser errors before attributing it to a driver or declaring the report resolved.

See the README's limitations before using this as an everyday production tool.
