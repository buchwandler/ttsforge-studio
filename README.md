# TTSForge

## Local Audiobook Builder

TTSForge is a local-first desktop client for building audiobooks with the TTSForge Python backend. The Svelte and TypeScript interface calls the versioned local API. Rust owns runtime installation, backend supervision, native desktop actions, and shutdown.

The user-facing product is TTSForge. The Tauri identifier remains `io.ttsforge.studio` to preserve existing installation and user-data identity. Do not change it without a migration plan.

## Compatibility source of truth

`runtime/runtime-manifest.toml` pins the desktop compatibility tuple:

| Component | Version |
| --- | --- |
| Python | 3.13 |
| TTSForge distribution | 0.5.1, `ttsforge[studio]` |
| TTSForge API | v1 |
| `static-ffmpeg` | 3.0 |
| `uv` | 0.13.7 |

The OpenAPI v1 contract is vendored at `api/ttsforge-v1.openapi.json`. Its SHA-256 is `94798bd26dd49d2c5efef49de647d335d6b1326e1f27459a4779794a06c4af97`. TypeScript wire types and contract constants are generated from that schema. Do not copy backend defaults or conversion rules into the UI.

## Requirements

- Node.js 22 or newer
- Rust 1.90 or newer
- Python 3.13 for repository scripts and tests
- Tauri 2 platform prerequisites, including WebKitGTK and GTK development packages on Linux

The desktop application provisions its own Python runtime through the pinned `uv` sidecar. A separate Python installation is not used for the managed backend.

## Development

Install the exact JavaScript dependency graph and run the frontend checks:

```bash
npm ci
npm run check
npm test
npm run contract:check
npm run build
python3 -m unittest discover -s tests -v
```

Run Rust checks with:

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Stage the pinned `uv` sidecar for the current target, then start the desktop app:

```bash
python3 scripts/fetch-uv.py
npm run tauri -- dev
```

The first runtime installation requires network access. Runtime status, repair, and diagnostics are available in the application.

For mock browser mode, run `npm run dev:mock`. For browser development against an already running TTSForge API, set `VITE_TTSFORGE_API_URL` and `VITE_TTSFORGE_TOKEN` before `npm run dev`. Keep local tokens out of source control. Browser mode does not install or supervise the backend and does not provide native file dialogs or output actions. The server must allow the browser page origin.

Tauri development uses Vite at `http://localhost:1420`. The Rust supervisor passes that exact development origin to the managed backend. `TAURI_DEV_HOST` can select a development host; the supervisor still restricts the origin to that host and port. Do not replace this allowlist with a wildcard.

## Runtime and media tools

The Rust supervisor starts TTSForge on an ephemeral local port, reads the `server.ready` record, verifies API v1 and authenticated system/runtime readiness, and reports failures through diagnostics. The API token is generated for the managed process and is not a public service credential.

The runtime manager provisions FFmpeg and FFprobe using the manifest-pinned `static-ffmpeg` release. TTSForge remains responsible for media processing and for validating runtime capabilities. The GUI does not invoke FFmpeg directly.

## Conversion and jobs

The conversion workflow preserves imported source identity, asks TTSForge to resolve setup defaults, and requests preflight before job creation. It shows blockers, warnings, and output conflicts before explicit confirmation. TTSForge remains authoritative for project and output defaults.

Job history, event cursors, retry, cancellation, and progress are retained in the desktop interface. When a job is active, closing the window offers two choices: minimize to the system tray and continue, or cancel the job and quit. Closing with no active job exits normally. Backend shutdown is also handled by the native application lifecycle.

## Troubleshooting

- If the sidecar is missing, run `python3 scripts/fetch-uv.py` for the current target.
- If the backend cannot start, check the Diagnostics page and the managed backend log in the application data directory. Confirm the runtime manifest and API schema versions agree.
- If FFmpeg or FFprobe is unavailable, use runtime repair and refresh diagnostics. TTSForge reports operational runtime problems.
- If Vite reports that port 1420 is occupied, stop the other development server or choose a separate Tauri development configuration.
- If a browser request is rejected, verify the API URL, local token, and server CORS origin. Browser mode does not use the Tauri development-origin allowlist.

## CI and release packaging

`.github/workflows/build.yml` runs deterministic `npm ci` checks, frontend and Python tests, Rust formatting, Clippy and tests, API contract verification, and unsigned desktop builds on Linux, macOS, and Windows. These validation artifacts are not public releases.

`.github/workflows/release.yml` is manually dispatched from a version tag. It fails closed unless the configured macOS and Windows signing credentials, matching application version, and an HTTPS link to Linux, macOS, and Windows smoke-test evidence are supplied. It signs and notarizes macOS bundles, signs Windows bundles, and creates provenance attestations. The workflow creates a draft release only. A maintainer must review the artifacts and evidence before publishing it. Do not publish a signed release without the required credentials and platform smoke tests.

## License

The desktop project source is licensed under Apache-2.0. See [LICENSE](LICENSE). This license does not relicense TTSForge, Python, `uv`, FFmpeg, frontend packages, Tauri, or other third-party components. Each distributed component retains its own license and notice requirements. Review those terms and include applicable notices when packaging or redistributing them.
