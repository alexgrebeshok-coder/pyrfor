# CEOClaw — AI-powered PM / Ops Platform

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/alexgrebeshok-coder/ceoclaw)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)]()

**🇷🇺 AI-powered платформа для управления проектами и операциями**
**🇺🇸 AI-powered PM / Ops Platform for portfolio execution**

**Live Demo:** [ceoclaw.vercel.app](https://ceoclaw.vercel.app/)

---

## 📸 Screenshots

### Dashboard — Центр управления
![Dashboard](screenshots/01_Dashboard.png)

### Projects — Проекты
![Projects](screenshots/02_Projects.png)

### Gantt Chart — Планирование
![Gantt Chart](screenshots/03_Gantt_Chart.png)

### Analytics — Аналитика
![Analytics](screenshots/04_Analytics.png)

### AI Chat — ИИ-ассистент
![AI Chat](screenshots/05_AI_Chat.png)

### Risk Matrix — Управление рисками
![Risks](screenshots/06_Risks_Matrix.png)

### Kanban Board — Задачи
![Kanban](screenshots/07_Kanban_Board.png)

---

## ✨ Features

### 📊 Portfolio Management
- **Dashboard** — обзор всех проектов, KPIs, карта локаций
- **Projects** — карточки проектов с прогрессом, бюджетом, сроками
- **Portfolio** — агрегация по портфелю

### 📅 Planning & Analytics
- **Gantt Chart** — визуализация этапов и зависимостей
- **Kanban Board** — управление задачами
- **Calendar** — события и дедлайны
- **Analytics** — метрики эффективности

### 👥 Team & Risks
- **Team** — участники и загрузка
- **Risks Matrix** — идентификация и управление рисками
- **Goals** — цели и фокус

### 🤖 AI Integration
- **AI Chat** — интеграция с OpenRouter, ZAI, OpenAI
- **Smart suggestions** — рекомендации на основе данных
- **Voice interface** — голосовое управление (в разработке)
- 🧑‍💻 **Browser IDE at /ide** — Monaco editor + AI chat + command runner

### 🗺️ Field Operations
- **Map** — карта локаций проектов
- **Logistics** — управление полевым контуром
- **Evidence ledger** — доказательная база

### 🌐 Multi-Language
- **RU** — Русский
- **EN** — English
- **ZH** — 中文

---

## 🛠️ Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript (strict mode) |
| **Database** | PostgreSQL (Prisma ORM) |
| **Styling** | Tailwind CSS |
| **UI Components** | Radix UI, Lucide Icons |
| **AI** | OpenRouter, ZAI, OpenAI APIs |
| **Maps** | OpenStreetMap, Leaflet |
| **Charts** | Recharts |
| **Deployment** | Vercel |

---

## 🚀 Quick Start

```bash
# Clone repository
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# Install dependencies
npm install

# Setup environment
cp .env.example .env

# Configure database
export DATABASE_URL='postgresql://user:pass@localhost:5432/ceoclaw'
export DIRECT_URL='postgresql://user:pass@localhost:5432/ceoclaw'

# Setup Prisma
npx prisma generate
npx prisma migrate deploy

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📋 Project Status

| Metric | Status |
|--------|--------|
| App / API routes | 131 |
| Automated tests | 132/132 passing |
| TypeScript | `strict: true` |
| Vulnerabilities | 0 |
| Production build | ✅ Clean |

---

## 🗺️ Roadmap

### ✅ Phase 1 — Dashboard (Done)
- Main dashboard UI
- Projects, tasks, team
- Russian localization

### ✅ Phase 2 — Backend API (Done)
- Prisma + PostgreSQL
- REST API endpoints
- Evidence ledger

### ✅ Phase 3 — UI Redesign (Done)
- Compact design
- Mobile responsive
- Apple-style UI

### ⏳ Phase 4 — AI Integration (In Progress)
- OpenClaw agents integration
- Voice interface
- Smart recommendations

### ⏳ Phase 5 — Enterprise
- 1C integration
- MS Project import
- Telegram bot

---

## 📄 Key Documents

- `PROJECT_STATUS.md` — текущий статус
- `ARCHITECTURE.md` — архитектура
- `ROADMAP.md` — дорожная карта
- `RUNBOOK.md` — операционный гайд

---

## 📜 License

MIT License — используйте свободно для любых целей.

---

## 👤 Author

**Александр Гребешок**
- GitHub: [@alexgrebeshok-coder](https://github.com/alexgrebeshok-coder)
- Project: [CEOClaw](https://github.com/alexgrebeshok-coder/ceoclaw)

---

## 🙏 Acknowledgments

- OpenClaw — AI agent framework
- Next.js — React framework
- Prisma — database toolkit
- Vercel — deployment platform

---

**CEOClaw** — AI-first платформа для управления проектами. Демократизация AI для всех.
