# Architecture documentation (pointer)

The **canonical** bilingual architecture pack for **Pyrfor + FreeClaude + CEOClaw** lives in the **FreeClaude** repository to keep a single source of truth next to the execution-kernel docs:

- **On GitHub:** [freeclaude `docs/architecture/`](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/docs/architecture) — start at [`README.md` there](https://github.com/alexgrebeshok-coder/freeclaude/blob/main/docs/architecture/README.md).

If you clone both repos locally (e.g. `pyrfor-dev` and `freeclaude-dev` as siblings), the same files are at:

`../freeclaude-dev/docs/architecture/README.md` (adjust relative path to match your layout).

That pack covers:

- Ecosystem boundaries (Pyrfor control plane ↔ FreeClaude engine ↔ Desktop)
- FreeClaude CLI, Desktop, MCP (CEOClaw, 1C)
- Pyrfor engine runtime, `pyrfor-fc-*` integration layer, multimodal router
- Pyrfor IDE (Tauri) and `vscode-extension/` map
- Routines / cron “unification” roadmap (FreeClaude `ROUTINES_PLAN.md` vs Pyrfor gateway)

Pyrfor-specific integration contracts are also summarized in [../integrations.md](../integrations.md) (in-repo) and in the [canonical architecture pack on GitHub](https://github.com/alexgrebeshok-coder/freeclaude/tree/main/docs/architecture).
