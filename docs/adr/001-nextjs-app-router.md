# ADR-001: Next.js 15 App Router

## Status
Accepted

## Context
CEOClaw requires a modern React framework with server-side rendering capabilities.

## Decision
Use Next.js 15 with App Router for the frontend application.

## Rationale
- **App Router**: Modern routing with React Server Components
- **Server Components**: Better performance with streaming
- **Type Safety**: Full TypeScript support
- **API Routes**: Built-in API layer without separate server

## Consequences
- All pages use App Router (`app/` directory)
- Server Components for data fetching
- API Routes in `app/api/` directory
- No `pages/` directory (Pages Router deprecated)

## Alternatives Considered
1. **Remix**: More mature, but requires separate server
2. **Pages Router**: Simpler, but deprecated in Next.js 15
3. **Custom React**: Maximum control, but loses Next.js benefits

## Notes
- Migration from Pages Router completed in March 2026
- All new features use App Router
