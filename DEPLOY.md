# CEOClaw Vercel Deployment Guide

Этот документ описывает процесс деплоя CEOClaw на Vercel с PostgreSQL базой данных Neon и Prisma migrations.

## 📋 Предварительные требования

- Аккаунт на [Vercel](https://vercel.com)
- Аккаунт на [Neon](https://neon.tech) (бесплатный tier: 0.5 GB storage)
- GitHub репозиторий с кодом CEOClaw
- Установленный Vercel CLI: `npm i -g vercel`

## 🚀 Шаг 1: Создание PostgreSQL базы в Neon

1. Зайдите на [neon.tech](https://neon.tech) и создайте аккаунт
2. Создайте новый проект:
   - Project name: `ceoclaw-db`
   - Region: `US East (Ohio)` или `EU (Frankfurt)` — выбирайте ближайший к вашим пользователям
   - PostgreSQL version: 16 (default)
3. После создания проекта вы получите:
   - **DATABASE_URL** — connection string с пулингом (для Prisma Client)
   - **DIRECT_URL** — direct connection (для миграций)

Пример:
```bash
DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

⚠️ **Важно:** Neon автоматически приостанавливает неактивные базы на free tier. Это нормально для Prisma.

## 🔐 Шаг 2: Настройка Environment Variables в Vercel

### Вариант A: Через Vercel Dashboard (рекомендуется)

1. Зайдите на [vercel.com](https://vercel.com) → выберите проект
2. Settings → Environment Variables
3. Добавьте переменные:

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://...neon.tech/neondb?sslmode=require` | Production |
| `DIRECT_URL` | `postgresql://...neon.tech/neondb?sslmode=require` | Production |
| `NEXTAUTH_SECRET` | (сгенерируйте: `openssl rand -base64 32`) | Production |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Production |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | Production |
| `DEFAULT_AI_PROVIDER` | `openrouter` | Production |
| `LOG_LEVEL` | `info` | Production |
| `SENTRY_DSN` | `https://key@sentry.io/project` | Production |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://key@sentry.io/project` | Production |

| `TELEGRAM_BOT_TOKEN` | (от @BotFather) | Production |

> Mock data mode has been retired; the application now requires a live database. Refer to `docs/mock-data.md` for historical notes and re-enabling instructions (for local dev or testing).

### Вариант B: Через CLI

```bash
# Установите Vercel CLI
npm i -g vercel

# Логин
vercel login

# Добавьте переменные
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add NEXTAUTH_SECRET production
vercel env add NEXTAUTH_URL production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add OPENROUTER_API_KEY production
vercel env add DEFAULT_AI_PROVIDER production
vercel env add LOG_LEVEL production
vercel env add SENTRY_DSN production
vercel env add NEXT_PUBLIC_SENTRY_DSN production
vercel env add SENTRY_TRACES_SAMPLE_RATE production
vercel env add TELEGRAM_BOT_TOKEN production
```

## 🏗️ Шаг 3: Деплой на Vercel

### Первый деплой

```bash
# Перейдите в директорию проекта
cd /path/to/ceoclaw-dev

# Запустите деплой
vercel --prod
```

При первом запуске Vercel CLI задаст вопросы:
- **Link to existing project?** — No (если проект новый)
- **Project name** — ceoclaw (или любое другое)
- **Framework preset** — Next.js (определится автоматически)
- **Build Command** — `npm run vercel-build` (копирует production schema, генерирует Prisma Client, проверяет runtime-ready Postgres schema, затем seed и build; `prisma migrate deploy` запускается только при `CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true`)
- **Output Directory** — `.next` (определится автоматически)

### Последующие деплои

```bash
vercel --prod
```

Или через Git push (автоматический деплой):
```bash
git push origin main
```

## ✅ Шаг 4: Проверка деплоя

После успешного деплоя:

1. **Проверьте health endpoint:**
   ```bash
   curl https://your-app.vercel.app/api/health
   ```
   
   Ожидаемый ответ:
   ```json
    {
      "status": "healthy",
      "timestamp": "2026-03-18T05:50:00.000Z",
      "version": "0.1.0",
      "uptime": 12345,
      "checks": {
        "database": { "status": "connected" },
        "ai": { "status": "available" },
        "storage": { "status": "ok", "keys": 0, "size": 0 }
      }
    }
   ```

2. **Откройте приложение в браузере:**
   - https://your-app.vercel.app
   - Должна загрузиться страница входа

3. **Проверьте логи в Vercel Dashboard:**
   - Project → Deployments → выберите последний деплой
   - Проверьте Function Logs на наличие ошибок

## 🔧 Шаг 5: Настройка домена (опционально)

1. В Vercel Dashboard → Settings → Domains
2. Добавьте ваш домен: `ceoclaw.yourcompany.com`
3. Настройте DNS записи согласно инструкции Vercel
4. Обновите переменные:
   - `NEXTAUTH_URL=https://ceoclaw.yourcompany.com`
   - `NEXT_PUBLIC_APP_URL=https://ceoclaw.yourcompany.com`

## 🗄️ Шаг 6: Миграции базы данных

Текущее состояние Prisma требует осторожности:

- `schema.prisma` и deploy-path ориентированы на Postgres
- `prisma/migrations/` и `migration_lock.toml` все еще отражают SQLite-shaped lineage
- поэтому `vercel-build` по умолчанию **не** запускает `prisma migrate deploy`
- и теперь **не** уходит в hosted SQLite fallback на Vercel/CI, потому что такой деплой выглядел зелёным, но ломался на runtime

Что это значит на практике:

1. **App-only деплои безопасны**: код, UI, auth, API и прочие изменения без Prisma schema можно деплоить как обычно.
2. **Schema-changing деплои заморожены** до тех пор, пока не будет создан новый Postgres baseline migration.
3. **Флаг `CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true` включайте только после**:
   - выбора source of truth для Postgres schema
   - генерации нового baseline migration на Postgres
   - `prisma migrate resolve` для существующей базы

До этого момента не считайте текущий `prisma/migrations/` надежным bootstrap-источником для свежей Postgres базы.

## 🐛 Устранение проблем

### Ошибка: "Prisma Client could not be generated"

**Причина:** Несовпадение версий Prisma или проблема со схемой/миграциями.

**Решение:**
```bash
rm -rf node_modules/.prisma
npm run prisma:prepare:production
npm run build
```

### Ошибка: "`prisma migrate deploy` fails"

Если вы вручную включили `CEOCLAW_ENABLE_PRISMA_MIGRATE_DEPLOY=true`, проверьте:

1. Что Postgres baseline migration уже пересобран, а не используется старая SQLite-shaped цепочка
2. Что `DIRECT_URL` указывает на доступный Postgres
3. Что вы не пытаетесь bootstrap-ить новую базу текущим `prisma/migrations/`

Если baseline еще не пересобран, выключите флаг и вернитесь к app-only деплоям.

### Ошибка: "Can't reach database server"

**Причина:** Неправильный DATABASE_URL или база приостановлена (Neon free tier).

**Решение:**
1. Проверьте `DATABASE_URL` в Vercel Environment Variables
2. Зайдите в Neon Console и "пробудите" базу
3. Перезапустите деплой

### Ошибка: "`CEOClaw schema is not ready for runtime`"

**Причина:** Postgres доступен, но обязательные таблицы CEOClaw ещё не созданы или схема не совпадает с runtime-ожиданием.

**Решение:**
1. Проверьте новый build step `check-production-db-readiness` в логах Vercel
2. Проверьте, что это не fresh Postgres без bootstrap
3. Не используйте текущую SQLite-shaped migration chain как bootstrap для новой Postgres базы

### Ошибка: "NEXTAUTH_SECRET is required"

**Причина:** Не задан NEXTAUTH_SECRET.

**Решение:**
```bash
# Сгенерируйте секрет
openssl rand -base64 32

# Добавьте в Vercel
vercel env add NEXTAUTH_SECRET production
```

### Ошибка: "Build timeout exceeded"

**Причина:** Vercel build timeout (по умолчанию 45 минут).

**Решение:**
1. Оптимизируйте сборку (проверьте размер зависимостей)
2. Увеличьте timeout в vercel.json:
   ```json
   {
     "functions": {
       "api/**": {
         "maxDuration": 60
       }
     }
   }
   ```

## 📊 Мониторинг

### Vercel Analytics

Включите в Vercel Dashboard → Analytics:
- Page Views
- Web Vitals (TTFB, FCP, LCP, CLS)

### Логирование

Vercel автоматически логирует:
- Build logs (сборка)
- Function logs (runtime ошибки)
- Runtime logs (console.log)

Просмотр:
```bash
vercel logs your-app.vercel.app
```

### Оповещения

Настройте оповещения в Vercel Dashboard → Settings → Notifications:
- Deployment failed
- Deployment succeeded
- Bandwidth limit warning

## 🔐 Безопасность

### Рекомендации:

1. **Никогда не коммитьте `.env` файлы** — они уже в `.gitignore`
2. **Используйте разные секреты для разных окружений:**
   - Development: `.env.local`
   - Production: Vercel Environment Variables
3. **Ограничьте доступ к Neon базе:**
   - IP whitelist (если возможно)
   - Connection pooling (DATABASE_URL)
4. **Регулярно ротируйте секреты:**
   - NEXTAUTH_SECRET
   - API ключи

## 📚 Дополнительные ресурсы

- [Vercel Documentation](https://vercel.com/docs)
- [Neon Documentation](https://neon.tech/docs)
- [Prisma on Vercel](https://www.prisma.io/docs/guides/deployment/deployment-guides/deploying-to-vercel)
- [NextAuth.js on Vercel](https://next-auth.js.org/deployment)

---

**Дата создания:** 2026-03-18  
**Версия CEOClaw:** 0.1.0  
**Автор:** Claude (OpenClaw Agent)
