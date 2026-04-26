# Pyrfor — VSCode Extension

A VSCode extension that connects to the local **Pyrfor daemon** over WebSocket and exposes an AI chat panel in the Activity Bar.

## Requirements

- VSCode 1.85+
- Pyrfor daemon running (default: `ws://127.0.0.1:18790/`)

## Getting Started

1. Install the extension (or run it from source with `F5`).
2. The extension activates automatically on startup.
3. Click the **Pyrfor** icon in the Activity Bar to open the Chat panel.
4. The status bar shows the current connection state.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `pyrfor.daemonUrl` | `ws://127.0.0.1:18790/` | WebSocket URL of the Pyrfor daemon |
| `pyrfor.autoConnect` | `true` | Automatically connect on startup |

## Commands

| Command | Description |
|---|---|
| `Pyrfor: Connect` | Connect to the Pyrfor daemon |
| `Pyrfor: Disconnect` | Disconnect from the Pyrfor daemon |
| `Pyrfor: Open Chat` | Open the Chat panel |
| `Pyrfor: Send Message` | Send a message to the daemon |

## Development

```bash
npm install
npm run build       # compile
npm run typecheck   # type-check without emitting
npm test            # vitest unit tests
```
