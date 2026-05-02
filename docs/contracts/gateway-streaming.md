# Pyrfor Gateway Streaming Contract

This document covers gateway surfaces that are intentionally not modeled as plain JSON request/response in `packages/engine/src/runtime/openapi.yaml`.

## `POST /api/chat/stream`

Transport: Server-Sent Events (`text/event-stream`).

Request body is the same shape as `IdeChatRequest` in OpenAPI: `{ text, sessionId?, workspace?, openFiles?, prefer? }`.

Each runtime event is emitted as an SSE message with a JSON `data:` payload:

```text
data: {"type":"token","text":"Hello"}

data: {"type":"tool","name":"exec","args":{"command":"npm test"}}

data: {"type":"tool_result","name":"exec","result":{"stdout":"ok"}}

data: {"type":"final","text":"Done"}

event: done
data: {}
```

Errors are emitted in-band because the HTTP status is already `200` once streaming starts:

```text
event: error
data: {"message":"Provider unavailable"}
```

## `WS /ws/pty/{id}`

Transport: WebSocket. Browser clients authenticate with `?token=<bearer>` because WebSocket constructors cannot set `Authorization` headers. Non-browser clients may use the HTTP bearer header during upgrade.

Flow:

1. Create a PTY session with `POST /api/pty/spawn`.
2. Connect to `ws://127.0.0.1:<port>/ws/pty/{id}?token=<bearer>`.
3. Client-to-server messages are UTF-8 terminal input bytes.
4. Server-to-client messages are UTF-8 terminal output bytes.
5. Resize through `POST /api/pty/{id}/resize` with `{ "cols": 120, "rows": 32 }`.
6. Close through `DELETE /api/pty/{id}` or by closing the WebSocket.

The gateway rejects missing/invalid auth during WebSocket upgrade when bearer auth is configured.
