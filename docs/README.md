# CEOClaw Documentation

> **Last Updated:** March 21, 2026

## Overview

CEOClaw is an AI-powered Project Management Dashboard with built-in OpenClaw AI agents.

### Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript 5
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: SQLite (dev), PostgreSQL (prod)
- **AI**: OpenClaw Gateway + Multiple AI providers
- **Auth**: NextAuth.js with RBAC

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  CEOClaw App                   │
├─────────────────────────────────────────────────┤
│  Frontend (Next.js 15)                        │
│  ├── Components (React 19)                   │
│  ├── Pages (App Router)                     │
│  └── Hooks & Utils                           │
├─────────────────────────────────────────────────┤
│  API Layer (Next.js API Routes)              │
│  ├── /api/ai/* - AI endpoints               │
│  ├── /api/projects/* - Project CRUD         │
│  ├── /api/tasks/* - Task management         │
│  └── /api/memory/* - Memory operations      │
├─────────────────────────────────────────────────┤
│  Business Logic                               │
│  ├── lib/ai/* - AI adapter & agents         │
│  ├── lib/repositories/* - Data access       │
│  └── lib/policy/* - RBAC & permissions      │
├─────────────────────────────────────────────────┤
│  Data Layer                                   │
│  ├── Prisma ORM                              │
│  ├── SQLite (development)                    │
│  └── PostgreSQL (production)                 │
└─────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Clone repository
git clone https://github.com/alexgrebeshok-coder/ceoclaw.git
cd ceoclaw

# Install dependencies
npm install

# Setup environment
cp .env.example .env.local
# Edit .env.local with your values

# Initialize database
npx prisma generate
npx prisma db push

# Start development server
npm run dev
```

## Project Structure

```
ceoclaw-dev/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── (pages)/           # Page components
│   └── layout.tsx         # Root layout
├── components/            # React components
├── lib/                   # Business logic
│   ├── ai/                # AI adapter & agents
│   ├── repositories/      # Data access layer
│   ├── policy/            # RBAC & permissions
│   └── auth/              # Authentication
├── prisma/                # Database schema
├── __tests__/             # Unit & integration tests
└── e2e/                   # E2E tests
```

## Key Features
- **AI Integration**: Built-in OpenClaw agents
- **Multi-provider AI**: Fallback chain (local → cloud)
- **RBAC**: Role-based access control
- **i18n**: Russian, English, Chinese
- **Real-time**: WebSocket support
- **Mobile-responsive**: Touch-friendly UI

## Environment Variables
```bash
# Database
DATABASE_URL="file:./prisma/dev.db"
DIRECT_URL="file:./prisma/dev.db"

# Auth
NEXTAUTH_SECRET="dev-secret-for-testing-only"
NEXTAUTH_URL="http://localhost:3000"

# AI Providers (optional)
AI_PROVIDER_PRIORITY="local-model,openrouter"
OPENROUTER_API_KEY="sk-or-v1-..."
ZAI_API_KEY="..."

# Telegram
TELEGRAM_BOT_TOKEN="..."
```

## API Endpoints
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `GET /api/tasks` - List tasks
- `POST /api/tasks` - Create task
- `POST /api/ai/chat` - AI chat
- `POST /api/ai/runs` - AI run
- `GET /api/memory` - List memories
- `POST /api/memory` - Create memory

## Testing
```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Accessibility tests
npx playwright test e2e/accessibility
```

## Deployment
```bash
# Build for production
npm run build

# Deploy to Vercel
vercel --prod
```

## Contributing
1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License
MIT

## Support
- GitHub Issues: https://github.com/alexgrebeshok-coder/ceoclaw/issues
- Discord: https://discord.com/clawd
