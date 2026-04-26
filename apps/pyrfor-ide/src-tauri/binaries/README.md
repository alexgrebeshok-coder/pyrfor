# Pyrfor IDE — bundled binaries

This directory holds optional sidecar executables that Tauri bundles inside
the application package via `bundle.externalBin` in `tauri.conf.json`.

---

## pyrfor-daemon

| Target | File name |
|---|---|
| macOS Apple Silicon | `pyrfor-daemon-aarch64-apple-darwin` |
| macOS Intel | `pyrfor-daemon-x86_64-apple-darwin` |
| Windows x64 | `pyrfor-daemon-x86_64-pc-windows-msvc.exe` |
| Linux x64 | `pyrfor-daemon-x86_64-unknown-linux-gnu` |

Already wired in `tauri.conf.json` under `bundle.externalBin`.

---

## ollama (optional local LLM server)

The Ollama supervisor in `src-tauri/src/sidecar.rs` looks for the binary
**adjacent to the app executable** (production) or **in `$PATH`** (fallback).
If neither is found the app emits an `ollama:unavailable` event and continues
without local model support.

To bundle a specific Ollama release:

### 1. Download

Get the matching binary from <https://github.com/ollama/ollama/releases>:

| Target | Asset to download |
|---|---|
| macOS Apple Silicon | `ollama-darwin` |
| macOS Intel | `ollama-darwin` (universal binary) |
| Windows x64 | `ollama-windows-amd64.exe` |
| Linux x64 | `ollama-linux-amd64` |

### 2. Rename

Rename the downloaded file to match the Tauri sidecar naming convention:

```
ollama-aarch64-apple-darwin          # macOS Apple Silicon
ollama-x86_64-apple-darwin           # macOS Intel
ollama-x86_64-pc-windows-msvc.exe   # Windows x64
ollama-x86_64-unknown-linux-gnu      # Linux x64
```

Place the renamed file in this `binaries/` directory and make it executable:

```sh
chmod +x binaries/ollama-aarch64-apple-darwin
```

### 3. Register in tauri.conf.json

Add the entry to `bundle.externalBin` so Tauri bundles and code-signs it:

```json
"bundle": {
  "externalBin": [
    "binaries/pyrfor-daemon",
    "binaries/ollama"
  ]
}
```

> **Note:** Tauri 2 verifies that every `externalBin` path resolves to an
> actual file at **build time**.  Do **not** add `"binaries/ollama"` to
> `tauri.conf.json` unless the binary is present in this directory — the build
> will fail otherwise.  The supervisor discovers and uses a bundled binary at
> **runtime** without requiring it to be listed in `externalBin`.

### 4. Disable auto-start

Set `PYRFOR_OLLAMA_AUTOSTART=false` (environment variable) to skip the
supervisor entirely.
