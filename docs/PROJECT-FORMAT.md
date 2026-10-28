# Editable project format, schema 1

Extension: `.teacherstudio`. Encoding: UTF-8 JSON. This is a versioned self-contained **JSON package**, not a ZIP archive. It needs no external source path and is not a flattened screenshot.

Top-level fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | Integer `1`; unknown schemas are rejected |
| `appVersion` | Initial application format marker, `"0.1.0"` |
| `id`, `title` | Lesson identity and display name |
| `subject`, `grade`, `topic`, `folder` | Organization metadata |
| `createdAt`, `updatedAt` | ISO UTC timestamps |
| `kind` | `"whiteboard"` or `"document"` |
| `pages` | Ordered nonempty array of page records |
| `source` | Required for documents: name, `"pdf"`/`"image"` kind and raw-file base64 data |

A page includes:

- Stable `id`, numeric `width` and `height`.
- Six-digit hex `background`.
- `pattern`: `plain`, `dots`, or `grid`.
- Ordered `annotations` array (later objects paint above earlier ones).

Every annotation has:

- Stable `id` and `type`: `pen`, `highlighter`, `line`, `arrow`, `rectangle`, `ellipse`, or `text`.
- `points`: at least one `{ x, y, pressure }`, in page coordinates. Pressure ranges from 0 to 1.
- Six-digit hex `color`, numeric `width`, and `opacity` between 0.05 and 1.
- Optional `text` and `fontSize` for text objects.

Shapes/lines use first/last points; freehand stores the sampled path; text starts at its first point with a top-aligned baseline model. Highlighter transparency is stored explicitly. Every stored object is editable after reopening.

Validation uses the exact Zod schemas in [model](../src/model.ts). Inputs are bounded: 2,000 pages, 50,000 objects per page, 100,000 samples per object, 10,000 characters per text object, finite bounded coordinates, 16,000 units per page side. These are input sanity limits, not performance guarantees. Serialized project files are capped at 150 MB; bundled source bytes at 75 MB. The source is decoded and independently inspected to match each page's dimensions and count before import.

Reimport assigns a new lesson ID so it cannot silently replace an existing lesson. Page/object IDs remain stable inside the imported lesson. The original source is always bundled in this first version; an external-reference-only option is intentionally unsupported because it would need missing-file relocation UI.

There is no historical migration to run for the initial schema. A future schema must add an explicit migration function and round-trip fixtures. Current unknown/malformed schemas produce errors; never silently coerce them into schema 1.

Example fixture: [editable whiteboard](../tests/fixtures/editable-whiteboard.teacherstudio).
