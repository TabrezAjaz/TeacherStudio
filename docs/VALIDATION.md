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
| Edge built-production acceptance | 5 tests passed |
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

The excluded development-only test dynamically imports the source PDF inspection helper to perform deep export pixel assertions. The other five tests run against the actual production assets, including a separate PDF import/annotate/export/reopen workflow, with no source-module imports.

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

See the README's limitations before using this as an everyday production tool.
