# TTSForge API v1 contract

This document describes the client boundary for the TTSForge desktop application. The authoritative, machine-readable contract is [`../api/ttsforge-v1.openapi.json`](../api/ttsforge-v1.openapi.json). Do not treat this summary as a second schema.

## Compatibility tuple

`runtime/runtime-manifest.toml` is the consumed source of truth for Python 3.13, TTSForge 0.5.2 with the `studio` extra, API v1, `static-ffmpeg` 3.0, and `uv` 0.13.7. The vendored OpenAPI document has SHA-256 `cdddbcd3d062d1d7bfc6e7b7f817087f1f756ba6c7f6cf020d2bd92d933e536d`.

`src/lib/api/generated.ts` and `src/lib/api/contract.ts` are generated from the OpenAPI document and manifest. Run `npm run contract:check` to verify generated types, API version, schema identity, and runtime pins. Make contract changes in the vendored schema and generator inputs, not in generated files.

## API surface used by the desktop

The API v1 contract includes these operation groups:

- Health, system, capabilities, and runtime status: `/api/v1/health`, `/api/v1/system`, `/api/v1/system/capabilities`, `/api/v1/system/runtime`
- Source inspection and import lifecycle: `/api/v1/sources/inspect`, `/api/v1/sources/import`, `/api/v1/sources/imports/{source_id}`
- Setup resolution and conversion preflight: `/api/v1/setup/resolve`, `/api/v1/conversions/preflight`
- Engine, target, voice, engine-option, spaCy, and speech-profile catalogs and provisioning
- Provider model resources: `/api/v1/resources/models`, `/api/v1/resources/models/status`, asynchronous operations at `/api/v1/resources/model-operations`, and operation polling.
- Project status, setup, narration, previews, variants, library browsing, metadata, chapters, and quality checks
- Persistent conversion jobs, cursor-based events, retry, and cancellation: `/api/v1/jobs` and `/api/v1/jobs/{job_id}/...`

Use the OpenAPI file for exact methods, request and response schemas, error models, and endpoint details.

## Authentication and local origins

The managed desktop backend binds to loopback on an ephemeral port and creates a per-process bearer token. The Rust supervisor reads the `server.ready` record, checks the negotiated API major, and verifies authenticated system and runtime endpoints before reporting the backend ready. The token is held in application memory and must not be logged or committed.

The health endpoint is public. Other API operations use `Authorization: Bearer <token>`. The API client in `src/lib/api.ts` parses structured error responses, verifies API compatibility, and passes `AbortSignal` through cancellable requests.

In Tauri development, Vite is served at `http://localhost:1420`. The supervisor explicitly passes that origin to the backend. `TAURI_DEV_HOST` may change the host, but the origin remains restricted to that host and port. Do not use wildcard origins.

Browser development uses `VITE_TTSFORGE_API_URL` and `VITE_TTSFORGE_TOKEN` to connect to an already running server. The server must allow the browser page origin. Browser mode does not provide Tauri runtime provisioning or native file operations. Keep local tokens in environment files that are not committed.

## Client behavior and domain ownership

The client asks TTSForge to inspect or import sources, resolve setup defaults, and run conversion preflight. It presents the response, blockers, warnings, and output conflicts before a user confirms job creation. Project and output defaults, conversion rules, validation, runtime capability checks, and job state remain backend-owned.

Job tracking uses canonical job status plus event cursors. The UI retains history and reconnect state, and exposes retry, cancel, and completed-output actions. Do not replace the API contract with guessed response fields or duplicate TTSForge domain rules in the frontend.
