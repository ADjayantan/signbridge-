# Aborted request overlay fix — 1 October 2026

The screenshot's red `aborted` error was reproduced by cancelling a partial POST to the running Vite `/api/chat` endpoint. Node rejected the incoming body iterator with `ECONNRESET`; the middleware passed this normal disconnection to Vite's error handler, which broadcast an error overlay to the app.

The new shared `server/nodeChatMiddleware.js` adapter handles request/response disconnection through an AbortController. Cancelled uploads stop before inference, disconnected streams cancel pending reads, and closed clients do not reach Vite's error middleware. Connected requests with unexpected errors still do. Oversized uploads continue to receive JSON HTTP 413, including chunked requests without Content-Length. Backpressure waits also end when the client disconnects. Both dev and production preview use this adapter; the HMR error overlay remains enabled for actual development failures.

Development restart also scanned the newly added Python environment, with 22,436 files and 2,003 directories under site-packages. Vite's watcher does not apply Git ignore rules. Configuration now excludes `.training-venv`, `.training-data` and `training/artifacts`; application source and `public/models` stay watched.

A separate camera integration issue was found and corrected: the installed Tasks Vision SDK emits zero visibility for hand landmarks whose protobuf has no visibility field. Detected complete, finite hand arrays now receive confidence 1, matching the original OpenHands extraction procedure. Body visibility remains unchanged; missing/invalid hands remain missing. This does not establish live signing accuracy.

Verification:

- Nine real localhost Node HTTP regressions pass: healthy GET/POST, cancellation during module loading, partial upload cancellation, streamed response disconnection, unexpected errors and declared/chunked size-limit rejection.
- Two additional SDK-shape regressions pass. Both learned models still match Python preprocessing and PyTorch probabilities within `1e-5` on the checked held-out examples.
- Full app checks pass: **95 Node + 70 UI tests**, production build and PWA generation. The unchanged Python training suite previously passed 25 checks.
- Three cancelled partial uploads against the actual fixed dev server produced no new Vite internal errors; `/` and `/api/chat?status=1` returned HTTP 200 before and afterward. Production preview also returned HTTP 200 for both endpoints.
- The actual browser reloaded Live Sign, opened the 49-word trained ISL mode, and returned to Live Sign. No `vite-error-overlay` remained. The final camera element was inactive: readyState 0 and 0×0 dimensions. No camera footage was recorded or uploaded in this debugging pass.

Live Sign's AI setup currently reports missing Gemini configuration. Its cloud interpretation/answers still need a server key. Local trained-word recognition is available through **Trained sign words · no AI key needed**, at `/#trained-sign`.

*Archived test capture omitted from this public source snapshot.*
