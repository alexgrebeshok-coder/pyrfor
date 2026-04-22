# ADR-001: Repo Split Strategy — Strangler Fig via pnpm Workspaces

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Александр Гребешок (Саша), Opus 4.7 (архитектура), Клод (анализ)
**Supersedes:** —

---

## Context

`ceoclaw-dev` — монолитный Next.js 15 репозиторий (~79 Prisma-моделей, 62 API-папки, 92 lib-модуля). По стратегическому плану v5.1 нужно разделить на 3 продуктовых бренда + общий движок:

- `@ceoclaw/engine` — open core (Apache 2.0)
- `@ceoclaw/business` — SMB-фичи (BSL 1.1)
- `@ochag/family` — Family consumer (Apache 2.0)
- `@freeclaude/coder` — Coder CLI + Studio (Apache 2.0)
- `@ceoclaw/ui` — shared design system

## Decision

**Выбираем «Strangler Fig» через pnpm-workspaces**, а не big bang split на 5 отдельных репозиториев.

### Четыре фазы:

| Фаза | Что | Когда |
|------|-----|-------|
| **R0** | Инфраструктура workspace (этот PR), код не трогаем | Неделя 1 |
| **R1** | Перенос модулей по 1 за PR (~40 PR) | Неделя 2 |
| **R2** | Prisma split + публикация engine как npm package | Неделя 3 |
| **R3** | `git subtree split` → `github.com/ceoclaw/engine` отдельный репо | Неделя 4 |
| **R4** | business/ochag/freeclaude → отдельные репо (только при триггере) | По требованию |

### Триггеры R4:
- Отдельная команда на продукт
- CI > 15 минут из-за размера workspace
- Лицензионные требования BSL 1.1 требуют физически отдельного репо
- Разные релиз-циклы приводят к конфликтам

## Consequences

**Позитивные:**
- 344+ тестов не ломаются (по 1 PR за раз, CI gate)
- Производственная DB не трогается до R3+
- Команда (3 человека) не распыляется на 5 репо одновременно
- Постепенное разделение уменьшает риск незапланированных breaking changes

**Негативные:**
- До R3 моно-репо продолжает расти — нужна дисциплина не добавлять бизнес-код в engine
- pnpm-workspace вводит новый toolchain (pnpm) рядом со старым (npm)

## Alternatives Considered

1. **Big bang split** — риск поломать 344 теста, 5 CI-пайплайнов, Prisma FK. Отклонено.
2. **Git submodules** — неудобен для разработки (детач HEAD, синхронизация). Отклонено.
3. **Nx/Turborepo** — избыточно до R3; добавим build cache в R2. Отклонено для R0.

## References

- Strategic Plan v5.1: `/Downloads/CEOClaw_Strategic_Plan_v5.1_2026-04-22.md`
- Repo Split Plan v1: `/Downloads/CEOClaw_Repo_Split_Plan_v1_2026-04-22.md`
