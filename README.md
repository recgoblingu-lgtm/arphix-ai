# ARPHIX AI

**ARPHIX AI** is a privacy-first, offline-first coding assistant maker. It gives users multiple coding-agent personalities, a ChatGPT-inspired local UI, deterministic intent detection, code scaffolding, local conversation storage, and local voice controls—without a hosted API, analytics SDK, CDN, package install, or database.

> **Honest capability boundary:** The repository runs immediately with a deterministic local rule engine. For genuine on-device generative responses and speech-to-text, connect the supplied local runtime to a locally installed `llama.cpp` server and `whisper.cpp` binary. ARPHIX deliberately does not silently substitute a cloud AI provider.

## What is included

| Capability | Included behavior | Privacy boundary |
|---|---|---|
| Agent personalities | Create, choose, and retain named coding agents with roles and traits | Stored in browser `localStorage` only |
| Intent detection | Local rules detect code generation, UI, debugging, explanations, reviews, tests, and planning | Runs in `web/engine.js` |
| Code assistance | Deterministic implementation templates with personality-aware framing | No requests when fallback is active |
| Local LLM adapter | Optional `llama.cpp` completion proxy on `127.0.0.1` | Runtime rejects non-loopback model URLs |
| Voice input | Browser recording → local runtime → local `whisper.cpp` | Audio goes only to `/api/transcribe` on the same machine |
| Voice output | Uses an installed **local** system voice only | Refuses unavailable/nonlocal voices |
| Conversation export | Markdown download generated in the browser | No upload |

## Quick start

ARPHIX has **zero npm dependencies**. It serves its own static files and local endpoints with Node.js.

```bash
git clone <your-GitHub-repository-url>
cd arphix-ai
npm start
```

Open `http://127.0.0.1:4173`. The first message works immediately in the deterministic offline mode. A local browser permission prompt appears only if the user presses the voice-record button.

## Enable actual local generation with llama.cpp

Run a compatible `llama.cpp` server on your own computer. The server must be a loopback URL; ARPHIX rejects any remote hostname. A typical local command is:

```bash
# Example only — paths and model selection are owned by the local operator.
llama-server -m ./models/your-model.gguf --port 8080

# In another terminal, start ARPHIX's local runtime.
LLAMA_SERVER_URL=http://127.0.0.1:8080/completion npm start
```

The ARPHIX runtime sends a compact personality system prompt and user prompt to that **local** service through its own `/api/chat` endpoint. If the server is absent, ARPHIX falls back to its deterministic rule engine and clearly labels that mode.

## Enable local voice transcription with whisper.cpp

ARPHIX expects a local `whisper.cpp` CLI and model. The runtime uses locally installed `ffmpeg` to convert browser audio to 16 kHz mono WAV, then invokes the local binary:

```bash
WHISPER_CLI=/absolute/path/to/whisper-cli \
WHISPER_MODEL=/absolute/path/to/ggml-model.bin \
npm start
```

No source recording is retained: temporary audio files are deleted after the local transcription attempt. If setup is missing, the interface explains the local requirement instead of routing the recording online.

## Architecture

```text
Browser (static app)
 ├─ UI + personalities + history      → localStorage
 ├─ Intent detector + rule engine     → web/engine.js
 ├─ Optional voice recording          → POST same-machine /api/transcribe
 └─ Optional local-model prompt       → POST same-machine /api/chat

Node local runtime
 ├─ Serves only repository static files
 ├─ Enforces CSP; denies path traversal
 ├─ Permits only loopback llama.cpp endpoint
 └─ Invokes only configured local whisper.cpp CLI
```

## Security and privacy choices

ARPHIX uses a restrictive content security policy: `connect-src 'self'`, no third-party scripts, no fonts, no analytics, no remote images, and no form posts. The optional local-model URL is validated to be `localhost`, `127.0.0.1`, or `::1`; it cannot be pointed to a remote hosted API. Browser transcripts, personalities, and chat history are never posted to a third-party service.

The application intentionally does not bundle model weights. Local model files are large, machine-specific, and excluded by `.gitignore` to prevent accidental publication. Users should inspect and comply with each selected model’s license before use.

## Commands

```bash
npm test   # run engine unit tests
npm run lint  # syntax-check client and local runtime
npm start  # run the local application
```

## Product roadmap

The MVP establishes the privacy architecture. Sensible next steps are encrypted local export/import, a WASM-native model path for browser-only operation, richer local code indexing, project file attachments with explicit permission boundaries, test-runner integrations, and a user-configurable `llama.cpp` prompt profile.

## License

MIT. See [LICENSE](LICENSE).
