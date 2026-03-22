# ADR-003: Authentication Strategy

## Status
Accepted

## Context
CEOClaw requires secure authentication with role-based access control.

## Decision
Use NextAuth.js with custom RBAC (Role-Based Access Control).

## Rationale
- **NextAuth.js**: Industry standard for Next.js
- **RBAC**: Granular permissions for different user roles
- **Session-Based**: Secure server-side sessions
- **Provider Support**: Ready for Yandex 360 integration

## Roles & Permissions

### Roles
- `EXEC` - Executive, full access
- `PM` - Project Manager, manage projects
- `OPS` - Operations, view and update tasks
- `FINANCE` - Financial data access
- `MEMBER` - Basic team member

### Key Permissions
- `VIEW_TASKS` - View tasks (all roles)
- `RUN_AI_ACTIONS` - Execute AI queries (EXEC, PM)
- `MANAGE_TASKS` - Create/update/delete tasks (PM, OPS)
- `ADMIN_ACCESS` - Admin operations (EXEC only)

## Consequences
- All API routes use `authorizeRequest` middleware
- Dev bypass: `CEOCLAW_SKIP_AUTH=true` (development only)
- Production requires valid session or API key

## Notes
- Implemented in Phase 1 (March 2026)
- See `app/api/middleware/auth.ts`
