# CEOClaw Code Review Report

**Date:** 2026-03-17
**Reviewer:** Claude (OpenClaw)
**Project:** CEOClaw Dashboard
**Path:** `/Users/aleksandrgrebeshok/ceoclaw-dev`

---

## 🚨 CRITICAL Issues (Fix Immediately)

### 1. Telegram Bot Token Exposed in Git

**File:** `lib/telegram/bot.ts:9`

```typescript
const token = '***REMOVED***';
```

**Risk:** Anyone with repo access can use your bot, send spam, steal data.

**Fix:**
```typescript
// lib/telegram/bot.ts
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

export const bot = new TelegramBot(token, { polling: true });
```

**Actions:**
1. Move token to `.env.local`:
   ```bash
   TELEGRAM_BOT_TOKEN=***REMOVED***
   ```
2. Revoke old token via @BotFather
3. Generate new token
4. Update `.env.local` with new token
5. Commit fix: `git add lib/telegram/bot.ts && git commit -m "fix: use env var for telegram token"`

---

### 2. Authentication Disabled in Production

**File:** `app/api/middleware/auth.ts:15`

```typescript
const SKIP_AUTH = process.env.CEOCLAW_SKIP_AUTH === "true" || true; // ← ALWAYS TRUE!
```

**Risk:** All API routes are publicly accessible without authentication.

**Fix:**
```typescript
const SKIP_AUTH = process.env.CEOCLAW_SKIP_AUTH === "true"; // Remove || true
```

**Actions:**
1. Remove `|| true` from auth middleware
2. Test auth flow locally
3. Ensure `CEOCLAW_SKIP_AUTH` is NOT set in Vercel environment

---

### 3. XSS Vulnerability in AI Chat

**File:** `components/ai/chat-message.tsx:97`

```typescript
<span
  key={i}
  dangerouslySetInnerHTML={{ __html: withBreaks }} // ← No sanitization!
/>
```

**Risk:** If AI returns `<script>alert('xss')</script>`, it will execute in user's browser.

**Fix:**
```typescript
import DOMPurify from 'dompurify';

// In formatMessage():
const sanitized = DOMPurify.sanitize(withBreaks);
return (
  <span
    key={i}
    dangerouslySetInnerHTML={{ __html: sanitized }}
  />
);
```

**Actions:**
1. Install DOMPurify:
   ```bash
   npm install dompurify @types/dompurify
   ```
2. Update `formatMessage()` to sanitize HTML
3. Test with malicious AI responses

---

## ⚠️ HIGH Priority Issues

### 4. npm Vulnerabilities in xlsx

**Issue:** 2 HIGH severity vulnerabilities in `xlsx` package

```
- Prototype Pollution (CVE-2024-XXXX)
- Regular Expression DoS (CVE-2024-XXXX)
```

**Fix:**
```bash
npm update xlsx
# Or replace with alternative:
npm uninstall xlsx
npm install exceljs
```

---

### 5. TypeScript Strict Mode Disabled

**File:** `tsconfig.json`

**Issue:** 172 uses of `any` / `@ts-ignore` without strict mode

**Fix:**
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

**Actions:**
1. Enable strict mode
2. Fix TypeScript errors (incrementally)
3. Run `npm run build` to verify

---

## 📊 MEDIUM Priority Issues

### 6. No Rate Limiting on Telegram Bot

**File:** `lib/telegram/bot.ts`

**Issue:** No rate limiting or spam protection

**Risk:** Bot can be spammed, DoS attacked

**Fix:**
```typescript
import { RateLimiter } from 'limiter';

const limiter = new RateLimiter({
  tokensPerInterval: 10,
  interval: 'minute',
});

bot.on('message', async (msg) => {
  if (!await limiter.tryRemoveTokens(1)) {
    bot.sendMessage(msg.chat.id, '⚠️ Слишком много запросов. Подождите минуту.');
    return;
  }
  // Handle message...
});
```

---

### 7. Missing Input Validation in Some Routes

**Files:** `app/api/tasks/[id]/move/route.ts`, etc.

**Issue:** Some routes use params directly without validation

**Example:**
```typescript
const { id } = params; // No validation
const task = await prisma.task.findUnique({ where: { id } });
```

**Fix:**
```typescript
import { z } from 'zod';

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const parsed = paramsSchema.safeParse(params);
if (!parsed.success) {
  return validationError(parsed.error);
}

const { id } = parsed.data;
```

---

### 8. No CORS Configuration

**Issue:** API routes have no explicit CORS policy

**Risk:** Can be called from any origin

**Fix:**
```typescript
// middleware.ts
import { NextResponse } from 'next/server';

export function middleware(request) {
  const response = NextResponse.next();

  response.headers.set('Access-Control-Allow-Origin', 'https://your-domain.com');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');

  return response;
}
```

---

## ✅ GOOD Practices Found

1. ✅ **Prisma ORM** - SQL injection protection built-in
2. ✅ **Zod Validation** - Input validation in most routes
3. ✅ **Rate Limiting** - Auth and AI rate limiting implemented
4. ✅ **.env in .gitignore** - Secrets not in git (except token)
5. ✅ **Error Handling** - Consistent error responses
6. ✅ **Dependency Injection** - Testable architecture
7. ✅ **TypeScript** - Type safety (needs strict mode)

---

## 📋 Action Plan

### Phase 1: Critical Fixes (Today)
1. ⏰ **NOW:** Revoke Telegram token
2. ⏰ **NOW:** Fix auth middleware
3. ⏰ **+30m:** Add DOMPurify for XSS

### Phase 2: High Priority (This Week)
4. 📅 **Day 1:** Update xlsx or replace
5. 📅 **Day 2:** Enable TypeScript strict mode

### Phase 3: Medium Priority (Next Week)
6. 📅 **Week 2:** Add rate limiting to Telegram bot
7. 📅 **Week 2:** Add input validation to all routes
8. 📅 **Week 2:** Configure CORS

---

## 🔒 Security Checklist

- [ ] Revoke exposed Telegram token
- [ ] Remove `|| true` from auth middleware
- [ ] Add DOMPurify to chat messages
- [ ] Update vulnerable npm packages
- [ ] Enable TypeScript strict mode
- [ ] Add rate limiting to Telegram bot
- [ ] Validate all route params
- [ ] Configure CORS
- [ ] Add CSP headers
- [ ] Enable HTTPS in production
- [ ] Add security.txt
- [ ] Review .env files for secrets

---

## 📊 Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 CRITICAL | 3 | ❌ Fix immediately |
| 🟠 HIGH | 2 | ⚠️ Fix this week |
| 🟡 MEDIUM | 3 | 📅 Fix next week |
| ✅ GOOD | 7 | Already implemented |

**Overall Security Score:** 6/10

**Recommendation:** Fix critical issues before any production deployment.

---

**Generated by OpenClaw Code Review**
**Time:** 14:35 MSK
**Duration:** 5 minutes
