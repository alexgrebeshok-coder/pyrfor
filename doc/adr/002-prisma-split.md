# ADR-002: Prisma Schema Split — One DB, Four Schema Files

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Александр Гребешок, Opus 4.7, Клод

---

## Context

79 Prisma-моделей в одном `prisma/schema.prisma`. По стратегии v5.1 движок и продукты имеют разные домены и лицензии — нужно разделить схему.

## Decision

**Не разделяем PostgreSQL базу физически.** Одна база, четыре `.prisma` файла:

```
prisma/
├── schema.prisma          ← существующий (не трогаем до R2)
├── engine.prisma          ← ~25 моделей (User, Memory, Agent, Skill, ...)
├── business.prisma        ← ~40 моделей (Project, Task, EVM, Risk, ...)
├── ochag.prisma           ← ~8 моделей (FamilyAccount, FamilyEvent, ...)
└── freeclaude.prisma      ← ~3 модели (CodeSession, CodeProject, ...)
```

### Четыре Prisma clients (алиасы):

```ts
import { PrismaClient } from '@ceoclaw/engine-db'   // engine.prisma
import { PrismaClient } from '@ceoclaw/business-db' // business.prisma
import { PrismaClient } from '@ochag/family-db'     // ochag.prisma
import { PrismaClient } from '@freeclaude/coder-db' // freeclaude.prisma
```

### tools/prisma-merge

Инструмент объединяет 4 файла → `merged.prisma` для:
- `prisma migrate` (миграции используют полную схему)
- `prisma db push` (в development)

### Cross-schema FK

Только через `userId` (ссылка на `engine.User`). Никаких прямых FK между `business.Project` и `ochag.FamilyEvent`.

## Timeline

- **R0-R1:** Работаем со старым единым `schema.prisma`
- **R2:** Разрезаем файлы, генерируем 4 клиента, пишем `tools/prisma-merge`
- **R3+:** Таблицы переименовываем только если нужен namespace (prefixing без ALTER TABLE — через `@@map`)
- **R5+ (не скоро):** Физически разделяем базу, если появится performance bottleneck

## Consequences

**Позитивные:**
- Нет downtime и ALTER TABLE при переходе
- Prisma migrate продолжает работать как прежде (через merged schema)
- Каждый продукт импортирует только свой client → меньше coupling

**Негативные:**
- До R2 все 79 моделей в одном файле — дисциплина нужна при добавлении новых
- `tools/prisma-merge` — доп. инфраструктурный код для поддержки

## Alternatives Considered

1. **Prisma multi-schema** (preview feature) — нестабильно в production как Prisma сам пишет. Отклонено.
2. **Физическое разделение DB сразу** — требует миграции данных и изменения FK. Слишком рано. Отклонено.
3. **Один client, разные модули** — не даёт linting-изоляции между доменами. Отклонено.

## References

- Prisma docs: https://www.prisma.io/docs/orm/prisma-schema/overview/referencing-other-schemas
- Repo Split Plan v1 §4: `/Downloads/CEOClaw_Repo_Split_Plan_v1_2026-04-22.md`
