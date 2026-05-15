# Саша's Ideathon — Систематизация идей (15.05.2026)

**Source:** 8 идей/инструментов, скинутых Сашей
**Research:** Exa AI search + web_fetch по каждому
**Status:** Анализ готов → обсуждение

---

## 1. Сводка всех идей

| # | Идея | Тип | Источник | Приоритет для Pyrfor |
|---|------|-----|----------|---------------------|
| 1 | **RL_Envs_101** — RL-среды для тренировки агентов | Skill/Инструмент | adithya-s-k/RL_Envs_101 | P2 — L4+ Self-Improvement |
| 2 | **/goal prompt structure** — формализованный промпт | Паттерн | Codex/Claude Code/Hermes | P0 — в AGENTS.md сейчас |
| 3 | **Claude Code /goal + /loop + /schedule** | Фича | Anthropic (май 2026) | P1 — у нас Completion Gate есть, надо CLI |
| 4 | **Lazyweb** — 250K скринов, MCP-сервер | Инструмент/MCP | lazyweb.com | P1 — Design Block |
| 5 | **Zenbu.js** — хакерский софт с исходниками | Фреймворк | zenbu.dev | P0 — референс для Block SDK |
| 6 | **Daybreak** — OpenAI security platform | Платформа | openai.com/daybreak | P2 — Security Block |
| 7 | **SimStudio** — визуальный композер агентов (25 блоков) | Платформа | simstudio.ai (OSS) | P1 — композер для Pyrfor-блоков |
| 8 | **Model-Native Skills** — навыки из embedding-пространства | Research | arXiv 2604.17614 | P2 — Skill Registry v2 |

---

## 2. Детальный разбор

### 2.1 RL_Envs_101 — RL-среды для обучения агентов

**Что это:** Skill для создания RL-сред в OpenEnv, OpenReward, Verifiers, NemoGym и др. Позволяет кодинг-агенту создавать среды под тип обучаемой модели.

**Исследование:** Прямых аналогов в открытом доступе мало. Большинство RL-фреймворков (RLlib, SB3) требуют ручного кодирования сред. RL_Envs_101 — первый skills-based подход к RL-средам.

**Для Pyrfor:**
- L4 Self-Modification Engine: RL вместо rule-based оптимизации
- Optimizer Agents тренируются на исторических postmortem-данных
- Сейчас: автономные улучшения через MetaCritic + acceptance tests
- Будущее: RL-тренировка оптимизаторов на Experience Library

**Действие:** Отложить до L4+. Сохранить ссылку. Когда Experience Library накопит ≥1000 записей — использовать для RL-тренировки.

---

### 2.2 /goal Prompt Structure — формализованный промпт

**Что это:** Структура: GOAL → CONTEXT → CONSTRAINTS → PRIORITY → PLAN → DONE WHEN → VERIFY → OUTPUT → STOP RULES

**Исследование:** Этот формат — эволюция chain-of-thought + structured prompting. Codex, Claude Code и Hermes независимо пришли к похожей структуре. Ключевое отличие от обычных промптов: явные STOP RULES и DONE WHEN.

**Сравнение с AGENTS.md:**
| /goal field | AGENTS.md equivalent | Status |
|-------------|---------------------|--------|
| GOAL | Task Execution Mode | ✅ |
| CONTEXT | Memory First, AGENTS.md context | ✅ |
| CONSTRAINTS | Surgical Changes | ⚠️ Частично |
| PRIORITY | Скорость→качество→экономия | ✅ |
| PLAN | Think Before Coding | ✅ |
| DONE WHEN | Verifiable goals | ⚠️ Не формализовано |
| VERIFY | Result Lock Protocol | ✅ |
| STOP RULES | "Stop when confused" | ⚠️ Только одна фраза |

**Для Pyrfor:**
- Добавить STOP RULES в AGENTS.md: «покажи неопределённости с ранжированными вариантами перед действием; не расширяй scope»
- Добавить DONE WHEN в Copilot-промпт: явное проверяемое условие завершения

**Действие:** Обновить AGENTS.md (+3 правила). Немедленно.

---

### 2.3 Claude Code /goal + /loop + /schedule

**Что это:** `/goal` — цикл до выполнения условия. `/loop` — итеративная работа. `/schedule` — запуск по расписанию. Stop hook — программный контроль завершения. Auto mode — без участия человека.

**Исследование:** Claude Code (май 2026) и Codex (апрель 2026) одновременно выпустили `/goal`. Это становится стандартом для coding agents.

**Сравнение с Pyrfor:**
| Claude Code | Pyrfor | Статус |
|-------------|--------|--------|
| `/goal` → loop until condition | Completion Gate Engine | ✅ Архитектура |
| `/goal` как CLI | `pyrfor concept --until` | ❌ Нет |
| `/loop` | Engine Loop + Ralph | ✅ |
| `/schedule` | Cron + Heartbeat | ✅ |
| Stop hook | Circuit Breaker + Permission | ✅ |
| Auto mode | Trust Panel auto-approve | ✅ |
| Goal visible в UI | Governed Strip | ⚠️ Нет goal display |

**Для Pyrfor:**
- Добавить `--until` флаг: `pyrfor concept "fix auth" --until "pnpm test --pass"`
- Показывать goal в Governed Strip: «Goal: tests passing | Attempt 3»

**Действие:** P1-фича, 1-2 дня Copilot.

---

### 2.4 Lazyweb — 250K скринов через MCP

**Что это:** MCP-сервер с базой 250 000 скринов рабочих приложений. Поиск референсов для дизайна. Бесплатно, без лимитов.

**Исследование:** Уникальный ресурс. Ближайший аналог — Mobbin (платный, 200K скринов). Lazyweb — первый, кто сделал это как MCP-сервер.

**Для Pyrfor:**
- Design Block: Lazyweb MCP → найти референс → ui-ux-pro-max skill → сгенерировать компонент
- Подключение через MCP gateway — без доп. кода

**Действие:** P1, при создании Design Block. Уже есть в плане.

---

### 2.5 Zenbu.js — Хакерский софт с исходниками

**Что это:** Фреймворк для десктоп-приложений (Electron), где приложение поставляется с исходным кодом. Пользователь редактирует приложение = клонирует репо + запускает в dev-режиме. Плагины для расширения.

**Исследование:** Автор — Rob (создатель React Scan, Million Lint). Философия: «нет разделения dev/prod». Приложения = живые репозитории.

**Для Pyrfor — прямое попадание в Block SDK (Phase A):**
- Блоки Pyrfor = Zenbu-приложения
- Устанавливаются с исходным кодом в `~/.pyrfor/blocks/<name>/`
- Пользователь (или Optimizer Agent) редактирует → hot reload
- Изменения через governed цикл: test → approve → apply
- Plugin-система Zenbu = Skill Registry Pyrfor

**Почему это важно:** Zenbu.js — working reference для Block SDK. Не надо изобретать — адаптировать под Pyrfor (Tauri вместо Electron, governed вместо open).

**Действие:** Изучить Zenbu.js архитектуру, адаптировать для Block SDK (G1). P0.

---

### 2.6 Daybreak — OpenAI Security Platform

**Что это:** Платформа для киберзащиты. Авто-поиск уязвимостей, валидация, реагирование. Использует модели OpenAI + Codex + партнёров по безопасности.

**Исследование:** Новый продукт OpenAI (май 2026). Закрытый, enterprise. Конкуренты: Snyk Code, GitHub CodeQL, Semgrep.

**Для Pyrfor:**
- Security Block — отдельный инфраструктурный блок
- Авто-сканирование кода всех установленных блоков (npm audit, cargo audit)
- Интеграция CVE-баз
- Auto-fix proposals через Optimizer Agent → Trust Panel

**Действие:** Добавить Security Block в стратегию. P2.

---

### 2.7 SimStudio — Визуальный композер агентов

**Что это:** Open-source (28K+ stars на GitHub, апр 2025). Drag-and-drop построение multi-agent workflow как directed graph. 25 типов блоков, branching, loops, conditional execution. Поддержка любых LLM + Ollama.

**Исследование:** Show HN (196 points). Авторы: Emir и Waleed. Философия: «визуальный workflow надёжнее неявного».

**Для Pyrfor:**
- SimStudio как frontend-композер для Pyrfor-блоков
- Пользователь визуально собирает workflow → под капотом Pyrfor Engine с governed lifecycle
- Блоки Pyrfor = ноды SimStudio
- SimStudio даёт визуальное программирование, Pyrfor даёт governed execution

**Действие:** P1. Интеграция SimStudio как опционального UI-слоя для композиции блоков.

---

### 2.8 Model-Native Skills — Навыки из embedding-пространства

**Что это:** arXiv 2604.17614. Навыки не как текст (SKILL.md), а как векторы в activation space модели. Ортогональный базис из активаций. Data selection: +20% на MATH, +41% на AMC. Inference-time steering: +4.8% на MATH.

**Связанные работы:**
- **Anthropic Agent Skills** (agentskills.io) — открытый стандарт, SKILL.md с YAML frontmatter, кросс-платформенный
- **SkillRouter** (arXiv 2603.22455) — роутинг навыков при 80K+ кандидатах. Full-text routing критичен: hiding skill body → −31-44pp accuracy
- **Microsoft Agent Framework Skills** — ещё одна реализация skills как модульных компонентов

**Для Pyrfor:**
- Сейчас: Skill Registry = SKILL.md (текстовые файлы), импорт из OpenClaw
- Ближнее: SkillRouter-подход — full-text indexing для semantic skill matching
- Дальнее: Model-Native Skills — скиллы как embedding-векторы, similarity search в пространстве активаций
- Experience Library уже использует embeddings → естественное расширение на skills

**Ключевой вывод SkillRouter:** Полный текст скилла критичен для routing accuracy. Нельзя показывать только name+description. Pyrfor Skill Registry уже хранит полные SKILL.md — мы на правильном пути.

**Действие:** P2. Skill Registry v2: embedding-based search + SkillRouter-подход.

---

## 3. Что мы должны использовать (ранжировано по impact/effort)

| # | Что | Impact | Effort | Priority |
|---|-----|--------|--------|----------|
| 1 | /goal STOP RULES + DONE WHEN → AGENTS.md | Высокий | 30 мин | **Сейчас** |
| 2 | Zenbu.js как референс для Block SDK | Высокий | Изучить | **P0** |
| 3 | `--until` флаг для pyrfor concept | Средний | 1-2 дня | P1 |
| 4 | Lazyweb MCP → Design Block | Средний | Подключить | P1 |
| 5 | SimStudio как композер блоков | Высокий | 2-4 нед | P1 |
| 6 | RL_Envs_101 для L4 Self-Improvement | Высокий | Отложить | P2 |
| 7 | Model-Native Skills для Skill Registry v2 | Высокий | 1-3 мес | P2 |
| 8 | Security Block (Daybreak-like) | Средний | 2-4 нед | P2 |

---

## 4. Обновлённый стек самоулучшения Pyrfor

```
Layer 4: RL TRAINING (RL_Envs_101)
  └─ Optimizer Agents тренируются на Experience Library

Layer 3: SELF-MODIFICATION (Zenbu.js pattern)
  └─ Блоки с исходниками, hot reload, governed apply

Layer 2: GOAL-DRIVEN EXECUTION (/goal pattern)
  └─ --until флаг, Completion Gate Engine, governed strip

Layer 1: EXPERIENCE & SKILLS
  └─ Experience Library (embeddings) → Model-Native Skills (activation space)
  └─ SkillRouter: full-text routing, 74% Hit@1 на 80K скиллах

Layer 0: ECOSYSTEM
  └─ SimStudio: визуальная композиция блоков
  └─ Lazyweb: 250K референсов для дизайна
  └─ Daybreak: security-модель для Safety Block
```

---

## 5. Темы для обсуждения с Сашей

1. **Block SDK сейчас или потом?** Zenbu.js даёт готовый референс. Можно начать Phase A немедленно. Или сначала добить миграцию OpenClaw→Pyrfor?

2. **SimStudio — конкурент или партнёр?** Они строят визуальный композер. Мы — governed runtime. Вместе: SimStudio frontend + Pyrfor backend = лучший продукт.

3. **Model-Native Skills — насколько глубоко идти?** Сейчас у нас SKILL.md. SkillRouter говорит: full-text routing. Model-Native paper говорит: embedding-пространство. Где остановиться?

4. **/goal pattern — формализовать в AGENTS.md?** Я предлагаю добавить STOP RULES и DONE WHEN. Это поменяет поведение всех агентов (включая Copilot).

5. **Security Block — приоритет?** Daybreak показывает, что индустрия движется к автономной киберзащите. Для Pyrfor с governed lifecycle — естественное расширение.

6. **Семейный бот — когда?** Мы начали анализ проблем (исторические факты без годов, пропущенные праздники). Доделать сейчас или после блока стратегических задач?

---

*End of analysis. Ready for discussion.*

**Author:** Клод Гребешок 🐾 | 2026-05-15
