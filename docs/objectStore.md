# Changes made on 2025-11-02 (migration / viewer / worker fixes)

This document summarizes the edits made today to support moving PDF storage to Supabase, stabilizing the Cloudflare Worker proxy, and improving the embedded PDF viewer experience.

## Goals addressed

- Migrate PDF files out of the repository into Supabase Storage and keep metadata in Postgres (`fileStore`).
- Provide robust upload and stream endpoints on the `cors-proxy` worker.
- Make the pdf.js viewer load files reliably across origins and avoid origin/validateFileURL failures.
- Harden the worker against inconsistent signing endpoint responses and avoid runtime JSON parse errors.


## High-level summary of changes

- Upload flow
  - Implemented multipart upload and SHA-256 checksum deduplication for uploaded files.
  - Uploaded objects are stored in Supabase Storage with storage keys that preserve original filenames.
  - Inserted metadata into the `fileStore` Postgres table, including `storage_key`, `content_type`, `filename`, `id`, and `link_title`.
  - Generator scripts were added/updated to produce `data/<subject>.json` files describing the site's PDF resources (units → groups → files with fields like `id`, `url`, `storage_key`, `filename`, `linkTitle`).

- Worker (cors-proxy) changes
  - Added defensive parsing and robust helpers around signed-url flows to handle variant sign endpoint shapes and avoid "Unexpected end of JSON input" errors when endpoints returned empty or non-JSON responses.
  - Implemented server-side (service-role) fetch workaround: instead of relying on the variable signing API behavior, the worker can use the Supabase service-role key to perform HEAD/GET directly against `storage/v1/object/<bucket>/<key>` and then proxy the bytes to the client. This avoids exposing signed tokens to clients and eliminates brittle client redirects.
  - Added explicit HEAD support on the worker so clients (and the viewer parent page) can check resource existence efficiently.
  - When proxying GETs, the worker now forwards the `Range` header so PDF viewers receive partial content requests (206) correctly.
  - Masked and limited logging for signed URL responses to avoid leaking tokens in logs while preserving useful debugging context.

- pdf.js viewer and viewer integration
  - Relaxed `validateFileURL` in the local `viewer.js` copies so the viewer accepts file URLs whose origin matches either the viewer origin OR the embedding page origin (document.referrer). This reduces false rejections when embedding the viewer in an iframe or when the worker runs on a different origin/port during development.
  - Updated `templates/pdf_viewer.html` (parent page) to normalize `file` query parameters:
    - Convert absolute worker `/api/resources/.../stream` URLs to same-origin relative paths when the parsed URL origin matches the current page origin. This gives the viewer a same-origin path whenever possible.
    - If the file URL points to a different origin (e.g., the dev worker on a different port), the parent attempts to fetch the bytes (the worker must allow CORS) and create a `blob:` URL in the parent, then pass that blob URL into the viewer. PDF.js accepts blob URLs and this avoids the origin-match validation.
    - Added a short-circuit in `checkPdfAvailable()` to immediately accept `blob:` URLs (skipping network HEAD/GET).
    - Used document location as the base when resolving relative/absolute URLs so that relative paths resolve correctly in the parent.


## Files modified (not exhaustive)

- `cors-proxy/src/api/rw-supabase.js`
  - Defensive JSON parsing for signing endpoints.
  - New helpers `getSignedUrl()` / `resolveSignedUrl()` to handle different response shapes.
  - Option to use service-role authentication to fetch objects directly and proxy responses.
  - Forward Range header and add HEAD handling.

- `cors-proxy/src/index.js`
  - Router wiring updated so `/api/resources/:id/stream` uses the new proxy/HEAD-capable handler.

- `static/pdfjs/web/viewer.js` and `public/pdfjs/web/viewer.js`
  - Modified `validateFileURL` logic to allow file origin to match viewer origin OR embedding origin (`document.referrer`).

- `templates/pdf_viewer.html`
  - Normalize `file` query param to same-origin relative path when appropriate.
  - Parent-side cross-origin fetch → create blob URL fallback and pass blob URL into the viewer.
  - `checkPdfAvailable()` short-circuits for `blob:` URLs.
  - Use `document.location` as base for URL resolution and added defensive error handling around cross-origin fetches.


## Verification steps performed / suggested

- Worker runtime:
  - Verified the worker no longer throws unhandled `Unexpected end of JSON input` when signing endpoints return empty or non-JSON.
  - Confirmed worker can proxy GETs with `Range` and return partial content (206) when the Supabase storage supports range requests.
  - Confirmed HEAD requests return meaningful status codes for existence checks.

- Viewer behavior:
  - Confirmed that same-origin `/api/resources/.../stream` (when normalized to a relative path) loads correctly in the embedded viewer.
  - Confirmed that, for cross-origin worker URLs, the parent can fetch and create a blob URL and that PDF.js accepts the blob URL (avoids origin validation errors) — this requires the worker to return appropriate CORS headers or to use the service-role proxy path.


## Caveats and next steps (non-exhaustive)

- The service-role fetch workaround uses the Supabase service role key in the worker. That key must be kept secret and not exposed to clients. Confirm that your Cloudflare Worker environment uses the service key as a secret and not embedded in client-side code.

- The parent-side blob fallback requires the worker to include `Access-Control-Allow-Origin` headers (or to be same-origin). If the worker does not expose CORS, the parent fetch will fail and the blob fallback will not work. In that case, prefer using the worker proxy to make the request server-side and return bytes to the parent.

- Signing endpoints across different Supabase deployments remain inconsistent (different param names like `expiresIn` vs `expires_in`, differing response shapes). The worker contains defensive parsing logic, but the most robust option is to centralize access via the worker using service-role auth or to standardize signing endpoint behavior.

- The generator's `data/<subject>.json` files must be served from a static/public location for `buildNav()` to fetch them in-browser. If you plan to keep them outside the public folder, rely on worker endpoints or IndexedDB population.


## Relevant logs and debug notes

- Observed parse errors in worker logs: "Unexpected end of JSON input" when calling `.json()` on empty responses from sign endpoints. Fixed by defensive parsing and fallback heuristics.
- Observed `InvalidSignature` and various 400 errors pointing to different required parameter names for different sign endpoints. Mitigated by falling back to service-role fetch in the worker.
