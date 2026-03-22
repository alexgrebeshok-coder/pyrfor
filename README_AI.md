# CEOClaw AI Integration

## 🚀 Быстрый старт

CEOClaw AI работает **из коробки** — просто добавьте API ключи в `.env.local`.
Если вам нужен нестандартный AI provider или внешний connector, используйте manifest layer из `docs/integration-platform.md`.
Операторский onboarding для manifest layer также виден в `/integrations`, где можно проверить live registry и missing secrets.

### 1. Добавьте API ключи

```bash
# .env.local

# OpenRouter (рекомендуется — Gemini 3.1 Lite, быстро и дешево)
OPENROUTER_API_KEY="sk-or-v1-ваш-ключ"

# ИЛИ ZAI (GLM-5, российский провайдер)
ZAI_API_KEY="ваш-ключ"

# ИЛИ OpenAI (GPT-5.2)
OPENAI_API_KEY="sk-ваш-ключ"
```

### 2. Запустите

```bash
npm run dev
```

### 3. Готово!

Откройте http://localhost:3000/chat и общайтесь с AI.

---

## 🎯 Режимы работы

CEOClaw автоматически выбирает режим:

| Режим | Условие | Описание |
|-------|---------|----------|
| **Provider** | Есть API ключ | Реальные ответы от OpenRouter/ZAI/OpenAI |
| **Mock** | Нет ключей | Mock-ответы для тестирования |
| **Gateway** | Локальный endpoint | Подключение к MLX server или любому OpenAI-compatible localhost endpoint |

### Приоритет провайдеров:

1. **OpenRouter** (по умолчанию) — Gemini 3.1 Lite
2. **ZAI** — GLM-5
3. **OpenAI** — GPT-5.2

---

## 🎤 Голосовой ввод

Работает в Chrome, Safari, Edge:

1. Нажмите кнопку микрофона 🎤
2. Разрешите доступ к микрофону
3. Говорите — текст появится в поле
4. Нажмите ещё раз для остановки

**Язык:** Русский (`ru-RU`)

---

## 📎 Загрузка документов

Поддерживаемые форматы:
- Изображения: JPEG, PNG, GIF, WebP
- Документы: PDF
- Текст: TXT, CSV, JSON, Markdown

**Лимит:** 10MB на файл

---

## ⚙️ Настройка провайдеров

### OpenRouter (рекомендуется)

```bash
OPENROUTER_API_KEY="sk-or-v1-..."
DEFAULT_AI_PROVIDER="openrouter"
```

**Модели:**
- `google/gemini-3.1-flash-lite-preview` (по умолчанию)
- `deepseek/deepseek-r1:free`
- `qwen/qwen3-coder:free`

### ZAI (российский провайдер)

```bash
ZAI_API_KEY="..."
DEFAULT_AI_PROVIDER="zai"
```

**Модели:**
- `glm-5` (по умолчанию)
- `glm-4.7`
- `glm-4.7-flash`

### OpenAI

```bash
OPENAI_API_KEY="sk-..."
DEFAULT_AI_PROVIDER="openai"
```

**Модели:**
- `gpt-5.2` (по умолчанию)
- `gpt-5.1`
- `gpt-4o`

### Desktop MLX (Tauri, out of the box)

On macOS desktop, CEOClaw can auto-start the local MLX server through the Tauri bridge when local mode is selected.
This is the recommended setup for "works immediately after install" on a MacBook or Mac mini.
On desktop, `auto` mode resolves to `local` so the app prefers the fine-tuned MLX path first.
The iPhone on-device AI version is a separate future track, documented in [plans/2026-03-20-iphone-on-device-ai-future-track.md](plans/2026-03-20-iphone-on-device-ai-future-track.md).

If you want to override the defaults, set:

```bash
CEOCLAW_MLX_HOST="127.0.0.1"
CEOCLAW_MLX_PORT="8080"
CEOCLAW_MLX_MODEL_PATH="/Users/you/.openclaw/models/qwen-3b-mlx"
CEOCLAW_MLX_ADAPTER_PATH="/Users/you/.openclaw/workspace/models/qwen-ceoclaw-lora-v7"
CEOCLAW_MLX_AUTO_START="true"
```

### Local MLX / OpenAI-compatible gateway

If you have a local OpenAI-compatible inference service, point the browser/runtime at it with:

```bash
OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789/v1/chat/completions"
OPENCLAW_GATEWAY_MODEL="openclaw:main"
SEOCLAW_AI_MODE="gateway"
```

For local loopback inference, `OPENCLAW_GATEWAY_TOKEN` is optional unless your gateway requires auth.
If you want the browser-side workspace to auto-open in local mode, set `NEXT_PUBLIC_OPENCLAW_GATEWAY_URL` to the same localhost endpoint and keep it aligned with `OPENCLAW_GATEWAY_URL`.
The AI settings page now shows the active execution mode (`mock`, `provider`, `gateway`, or `unavailable`) so it is clear whether the app is using a live provider, a local MLX model, or the dev fallback.
On desktop, the app will also warm up the local MLX server automatically when local mode is selected.

### Manifest-driven providers and connectors

If your provider is OpenAI-compatible, you can register it without touching the core runtime:

```bash
CEOCLAW_AI_PROVIDER_MANIFESTS='[
  {
    "name": "custom-ai",
    "displayName": "Custom AI",
    "description": "Manifest-driven OpenAI-compatible provider",
    "baseURL": "https://custom-ai.example.com/v1",
    "apiKeyEnvVar": "CUSTOM_AI_API_KEY",
    "defaultModel": "custom-model",
    "models": ["custom-model", "custom-model-mini"]
  }
]'

CUSTOM_AI_API_KEY=sk-...
```

For GPS, messenger, ERP, or other HTTP-based systems:

```bash
CEOCLAW_CONNECTOR_MANIFESTS='[
  {
    "id": "slack",
    "name": "Slack",
    "description": "Slack workspace bridge",
    "direction": "bidirectional",
    "sourceSystem": "Slack Web API",
    "operations": ["Receive workspace events", "Send operational notifications"],
    "credentials": [
      {"envVar": "SLACK_BASE_URL", "description": "Slack API base URL"},
      {"envVar": "SLACK_BOT_TOKEN", "description": "Bot token"}
    ],
    "apiSurface": [
      {"method": "GET", "path": "/api/connectors/slack", "description": "Connector status"}
    ],
    "probe": {
      "baseUrlEnvVar": "SLACK_BASE_URL",
      "path": "/api/auth.test",
      "authEnvVar": "SLACK_BOT_TOKEN",
      "expectation": "json-field",
      "responseField": "ok"
    }
  }
]'
```

### Local inference / OpenAI-compatible gateway

If you want CEOClaw to use a local MLX-backed model or a localhost gateway in the browser/runtime, point it at a local OpenAI-compatible endpoint:

```bash
NEXT_PUBLIC_OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789/v1/chat/completions"
OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789/v1/chat/completions"
# Optional if your gateway requires auth:
OPENCLAW_GATEWAY_TOKEN="..."
OPENCLAW_GATEWAY_MODEL="openclaw:main"
SEOCLAW_AI_MODE="gateway"
```

For local loopback inference, the token is optional. If the URL is present, CEOClaw treats the gateway as available.
The AI settings screen shows this status explicitly so operators can confirm whether the app is talking to a live provider, a local MLX model, or the built-in mock fallback.
You can also probe the browser-side local path with `GET /api/ai/local` and run a live prompt with `POST /api/ai/local`.

---

## 🔧 Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `OPENROUTER_API_KEY` | Ключ OpenRouter | — |
| `ZAI_API_KEY` | Ключ ZAI | — |
| `OPENAI_API_KEY` | Ключ OpenAI | — |
| `DEFAULT_AI_PROVIDER` | Провайдер по умолчанию | `openrouter` |
| `SEOCLAW_AI_MODE` | Режим: `mock`, `provider`, `gateway` | Auto-detect |
| `CEOCLAW_MLX_HOST` | Host локального MLX server для desktop bridge | `127.0.0.1` |
| `CEOCLAW_MLX_PORT` | Port локального MLX server | `8080` |
| `CEOCLAW_MLX_MODEL_PATH` | Путь к базовой MLX модели | `.openclaw/models/qwen-3b-mlx` |
| `CEOCLAW_MLX_ADAPTER_PATH` | Путь к LoRA adapter | `.openclaw/workspace/models/qwen-ceoclaw-lora-v7` |
| `CEOCLAW_MLX_AUTO_START` | Автостарт local MLX server на desktop | `true` |
| `NEXT_PUBLIC_OPENCLAW_GATEWAY_URL` | Browser-visible URL local gateway | — |
| `OPENCLAW_GATEWAY_URL` | URL local gateway / OpenAI-compatible endpoint | — |
| `OPENCLAW_GATEWAY_TOKEN` | Token for local gateway (optional) | — |
| `CEOCLAW_AI_PROVIDER_MANIFESTS` | Custom AI provider manifests (JSON array) | — |
| `CEOCLAW_CONNECTOR_MANIFESTS` | Custom connector manifests (JSON array) | — |

---

## 📊 Архитектура

```
User Input
    ↓
ChatInput.handleSubmit()
    ↓
submitPrompt() → adapter.runAgent()
    ↓
POST /api/ai/runs
    ↓
getExecutionMode() → "provider" | "mock" | "gateway"
    ↓
Provider: AIRouter.chat() → OpenRouter/ZAI/OpenAI
Mock: buildMockFinalRun()
Gateway: invokeOpenClawGateway()
    ↓
Polling: GET /api/ai/runs/[id]
    ↓
UI Update: ChatMessages
```

---

## 🧪 Тестирование

### Тест API

```bash
curl -X POST http://localhost:3000/api/ai/runs \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {"id": "test", "kind": "analyst", "nameKey": "test", "accentClass": "test", "icon": "📊", "category": "strategic"},
    "prompt": "Привет!",
    "context": {
      "locale": "ru",
      "activeContext": {"type": "portfolio", "title": "Test"},
      "projects": [],
      "tasks": [],
      "team": [],
      "risks": [],
      "notifications": []
    }
  }'
```

### Тест голосового ввода

Откройте http://localhost:3000/chat в Chrome и нажмите микрофон.

---

## 📝 Примеры

### Portfolio Analyst

```typescript
// Agent: portfolio-analyst
// Prompt: "Покажи статус портфеля"
// Response: Структурированный статус с highlights и next steps
```

### Status Reporter

```typescript
// Agent: status-reporter
// Prompt: "Сгенерируй weekly update"
// Response: Draft статуса для отправки стейкхолдерам
```

---

## 🚧 Roadmap

- [ ] AI Settings page (UI для настройки провайдеров)
- [ ] Skills System (weather, research, evaluation)
- [ ] QA Agent (автотесты)
- [ ] Memory System (long-term memory в базе)
- [ ] Multi-language voice input

---

## 📚 Документация

- [ЭТАП 1: File-Based Backend](memory/2026-03-14.md#18:42)
- [ЭТАП 2: Agent Orchestrator](memory/2026-03-14.md#18:42)
- [ЭТАП 3: AI Chat Widget](memory/2026-03-14.md#20:02)
- [Voice + Attachments](memory/2026-03-14.md#20:02)

---

## 🆘 Troubleshooting

### "Provider not available"

Проверьте API ключи в `.env.local`:
```bash
grep API_KEY .env.local
```

### "Voice input not supported"

Используйте Chrome, Safari или Edge. Firefox не поддерживает Web Speech API.

### "CORS error"

Убедитесь, что dev server запущен на `localhost:3000`.

---

## 📞 Поддержка

- GitHub: https://github.com/alexgrebeshok/ceoclaw
- OpenClaw Community: https://discord.com/invite/clawd

---

**Версия:** 1.0.0
**Обновлено:** 2026-03-14
