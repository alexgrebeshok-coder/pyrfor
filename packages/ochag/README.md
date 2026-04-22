# @ochag/family

**Очаг** — семейный AI-помощник.

*«Очаг — твой семейный AI. Запоминает важное, не отдаёт никому, не продаёт рекламу.»*

**License:** Apache 2.0
**Status:** 🔧 R1 migration + 🚀 Phase 1 active development

---

## What lives here

| Module | Description |
|--------|-------------|
| `src/family-calendar/` | Семейный календарь (дни рождения, школа, события) |
| `src/voice-profile/` | Voice profile per family member |
| `src/vault/` | Защищённое хранилище (пароли, документы) — Family+ tier |
| `src/reminders/` | Персональные напоминания для членов семьи |
| `src/brief/` | Утренний брифинг семейного дня |
| `src/tma/` | Telegram Mini App entry points |
| `src/safety/` | Child safety policy, consent log |

## ICP

Взрослый 28–55 в семье, есть супруг(а), 0–3 детей, Telegram-пользователь.

## Pricing

Free → Personal 290₽ → Family (до 3) 390₽ → Family+ (до 6, Vault, биометрия) 990₽

## Dependencies

```
@ochag/family → @ceoclaw/engine
@ochag/family → @ceoclaw/ui
```

## Development

```bash
pnpm --filter @ochag/family dev
pnpm --filter @ochag/family typecheck
pnpm --filter @ochag/family test
```

## Domain

`ochag.ai`, bot: `@ochagbot`
