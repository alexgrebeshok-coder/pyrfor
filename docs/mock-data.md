# Mock Data Mode (Legacy)

## Текущее состояние

- В PROD-режиме приложение всегда требует PostgreSQL/Neon. `lib/server/runtime-mode.ts` теперь возвращает `shouldServeMockData() === false` и не проверяет `APP_DATA_MODE`.
- `APP_DATA_MODE` удалён из `.env.production`, `.env.vercel`, `.env.example`, `DEPLOY.md` и `README`. Сервисные справки и CI больше не выставляют этот флаг.
- Все API маршруты, middlewares и агенты ожидают живую базу и не переключаются на in-memory контекст.

## Когда всё ещё пользуемся mock-данными

Если нужно быстро покрутить интерфейс без подготовки базы:

1. Настройте `.env` по шаблону `.env.example`, укажите локальный или disposable Postgres `DATABASE_URL` / `DIRECT_URL` и при необходимости пропишите `CEOCLAW_SKIP_AUTH=true`.
2. Установите окружение:
   ```bash
   cp .env.example .env
   npm install
   npx prisma db push
   ```
3. Залейте тестовые данные:
   ```bash
   npm run seed:auth
   npm run seed:demo
   ```
   `prisma/seed-demo.ts` и `lib/mock-data.ts` содержат статические записи, которые используются в тестах и некоторых вспомогательных контекстах.
4. Запустите `npm run dev`. UI останется работоспособным, но большинство реальных API ожидают живую Postgres БД и вернут ошибку, если схема не заполнена.

> Для производства `APP_DATA_MODE` не нужен; используйте реальные `DATABASE_URL`/`DIRECT_URL` и API ключ AI. Если нужно воспроизвести демо-поток, запустите `seed:demo` и/или используйте `lib/ai/quick-actions.ts` вручную.

## Оставшиеся ссылки, которые нуждаются в ревизии

- `FEATURES_CHECKLIST.md` (Demo toggle)
- `PHASE3-PROMPTS.md` / `ARCHITECTURE.md` / `plans/2026-03-11-wave0-baseline.md` (обсуждают режимы)
- `README.md` (обновлён, но ещё стоит проверить связанную документацию и переписать описание режима)
- `lib/server/api-utils.ts`, `lib/tenant-readiness/service.ts`, `lib/__tests__/*` (они все упоминают `APP_DATA_MODE` в сообщениях)
- Компоненты и API (`app/api/*`, `lib/ai/mock-adapter.ts`) — уже используют mock-data для story/test purposes; планируйте их миграцию на реальный backend.

## Следующие шаги

1. Удалить `APP_DATA_MODE` из `lib/__tests__` (тесты должны проверять живой `databaseConfigured`).
2. Перевести документацию (учебники, промпты, README) на новую реальность: только живые данные, mock-режим отдельно документирован.
3. Если mock-data нужен для быстрых проб, держите скрипты (`seed:demo`) и отдельные компоненты в `lib/mock-data.ts` (они не задействованы в проде) и отмечайте их как экспериментальные.
