# TTSForge Studio — MVP

A local-first graphical frontend for TTSForge.

This MVP intentionally keeps audiobook logic in Python/TTSForge and uses:

- Svelte 5 + TypeScript for the UI;
- Tauri 2 for the desktop shell;
- a bundled `uv` sidecar to provision a private Python runtime;
- the planned TTSForge `/api/v1` local HTTP API;
- polling for conversion progress;
- a mock mode so the UI can be evaluated before the TTSForge server work lands.

## Status

This is an integration MVP, not a production release.

The real backend integration expects the API described in:

```text
docs/API_CONTRACT.md
```

and in the companion TTSForge implementation brief.

Until that backend exists, run:

```bash
npm install
npm run dev:mock
```

to exercise the UI with simulated data.

## Desktop development

Prerequisites:

- Node.js 22+
- Rust 1.90+
- platform requirements for Tauri 2

Install JS dependencies:

```bash
npm install
```

Stage the pinned `uv` sidecar for your current Rust target:

```bash
python3 scripts/fetch-uv.py
```

Then:

```bash
npm run tauri dev
```

The desktop app can provision:

```text
<app-data>/runtime/
  python/
  venv/
  uv-cache/
```

using a managed Python 3.13 interpreter and:

```text
ttsforge[studio]>=0.5.0,<0.6
```

## Browser development against a real server

Start the future TTSForge server separately and set:

```bash
export VITE_TTSFORGE_API_URL=http://127.0.0.1:8765
export VITE_TTSFORGE_TOKEN=your-token
npm run dev
```

When the frontend is served by the TTSForge server itself, `VITE_TTSFORGE_API_URL` can be omitted and same-origin requests are used.

## Design boundary

Studio does not:

- import Readio;
- know AudioExport;
- know UtterPlan;
- know VoiceRender;
- parse Rich output;
- reproduce TTSForge setup rules.

Studio only consumes TTSForge's application-facing API.

## MVP workflow

1. Install/check managed runtime.
2. Start local TTSForge server.
3. Select an EPUB.
4. Inspect metadata/chapters.
5. Pick language, engine, target, voice, spaCy tier and pause timing.
6. Start a conversion job.
7. Poll job state and display normalized progress.
8. Show completion or structured failure.
9. Cancel the active job.

## Runtime packaging

The repository does not commit third-party `uv` executables.

`scripts/fetch-uv.py` downloads the pinned uv release for the current Rust target, verifies the published SHA-256 file, and stages it under:

```text
src-tauri/binaries/uv-<target-triple>[.exe]
```

Tauri then bundles it through `bundle.externalBin`.

For production releases, invoke that script in each platform CI job before `tauri build`.

## FFmpeg

This MVP does not bundle FFmpeg yet.

The intended production split is:

- Studio packages/manages FFmpeg/FFprobe;
- Studio prepends its managed tools directory to the Python backend PATH;
- TTSForge/Readio/AudioExport validate and use the tools.

Do not make the GUI call FFmpeg directly.

## License

No project license is imposed by this generated MVP. Add the license you want before publishing the repository.
