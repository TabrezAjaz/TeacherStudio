# Dependencies, licenses and distribution

The exact JavaScript dependency graph is pinned by [package-lock](../package-lock.json). Use `npm ci` for reproducible restoration. `npm audit` reported zero known advisories after updating PDF.js and Vitest during this implementation; rerun it before distributing a release. This is an advisory check, not a security certification.

## Runtime choices

| Dependency | Role | Installed license |
|---|---|---|
| React / React DOM | UI and event handling | MIT |
| PDF.js (`pdfjs-dist`) | Page rendering, text layer, inspection | Apache-2.0 |
| pdf-lib | Original PDF page copying and compositing | MIT |
| perfect-freehand | Pressure-aware smoothed stroke outlines | MIT |
| idb | Small typed IndexedDB wrapper | ISC |
| Zod | Versioned project input validation | MIT |
| lucide-react | Icons | ISC |
| Tauri JS API / CLI | Desktop command bridge and build tools | Apache-2.0 OR MIT |

Development tooling: TypeScript, Vite, Vitest, ESLint, Testing Library, jsdom, fake-indexeddb and Playwright. Check each installed package's own license and transitive notices when assembling a redistributed binary; development and runtime dependency categories are not a substitute for a distribution audit.

Rust declarations use Tauri 2, tauri-build 2, serde 1, rfd 0.15, tempfile 3 and url 2. They have not been resolved into a Cargo lockfile or compiled here because the Rust/MSVC toolchain is missing. Resolve, review licensing, retain the generated `Cargo.lock`, and run `cargo test`/`cargo check` as part of the first native build. No claim is made about unbuilt Rust transitive dependencies.

## Bundled assets

- The application logo and teaching fixtures are original assets generated for this project.
- No product branding, proprietary interface assets or downloaded classroom documents are included.
- PDF.js's CMaps, standard fonts and WASM are copied from the installed package to local build assets. The copied directories retain their distributed license files, including `LICENSE_FOXIT` and `LICENSE_LIBERATION`. Preserve them in distributions.
- UI/annotation text uses local system fonts (Segoe UI / Arial fallbacks); no remote font request or separately redistributed Microsoft font file is involved.
- Preserve the PDF.js Apache license, copyright and notices and applicable licenses for all redistributed libraries. The PDF asset-copy script includes the top-level PDF.js license in the generated asset directory.

## Optional system components

LibreOffice is an optional, separately installed local converter (not bundled or downloaded by the application). Review its own MPL/LGPL and font licensing when distributing it separately. The app does not use a paid conversion API.

WebView2 is a Microsoft runtime governed by its own redistribution terms. The configured installer uses the official download bootstrapper if needed; a fully offline installer should be separately configured and tested with the WebView2 offline runtime.

The project owner's choice of license for original application source is not inferred by third-party dependency licenses. Choose and add that license before public distribution.
