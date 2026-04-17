# CEOClaw — Technical Debt Report

**Date:** 18 марта 2026  
**Version:** 0.2.1

---

## 📊 Technical Debt Overview

| Severity | Count | Priority |
|----------|-------|----------|
| 🔴 Critical | 0 | — |
| 🟠 High | 2 | Fix Next Sprint |
| 🟡 Medium | 3 | Fix in 2-4 weeks |
| 🟢 Low | 6 | Backlog |

**Total Issues:** 11  
**Debt Score:** 2.5/10 (Low)

---

## 🔴 Critical Issues (0)

Нет критичных проблем ✅

---

## 🟠 High Priority Issues (2)

### 1. ~~TypeScript ignoreBuildErrors~~ ✅ FIXED

**Status:** RESOLVED (18 марта 2026)

**What was done:**
- Fixed all EVM imports
- Removed deprecated lib/resource files
- Fixed mock-data types
- Added missing translation keys
- Removed `ignoreBuildErrors` from next.config.mjs

**Result:** 0 TypeScript errors

---

### 2. Bundle Size (938MB)

**Location:** `.next/` directory  
**Issue:** Production bundle занимает 938MB

**Breakdown:**
- Recharts chunks: ~4.5MB each
- Static pages: ~200MB
- Source maps: ~300MB
- Other chunks: ~233MB

**Impact:**
- Slow deployment
- High bandwidth usage
- Poor caching

**Solution:**
1. Remove source maps in production
2. Complete lazy loading for all charts
3. Implement tree-shaking
4. Use `next/image` for all images
5. Enable compression

**Estimated Time:** 8-12 hours  
**Priority:** P0

---

### 3. Low E2E Test Coverage

**Location:** `e2e/smoke.spec.ts`  
**Issue:** Только 5 smoke tests (из 20+ нужных)

**Missing Tests:**
- Form submissions
- API error handling
- AI Chat functionality
- File uploads
- Real-time updates
- Visual regression

**Impact:**
- Regressions undetected
- Manual testing required
- Low confidence in releases

**Solution:**
1. Add integration tests for each module
2. Add visual regression tests
3. Add API contract tests
4. Target: 50+ E2E tests

**Estimated Time:** 16-20 hours  
**Priority:** P1

---

## 🟡 Medium Priority Issues (4)

### 4. npm Vulnerabilities

**Location:** `package.json`  
**Issue:** HIGH vulnerability в `xlsx` package

```
xlsx 0.18.5
Severity: high
Prototype Pollution - https://npmjs.com/advisories/...
```

**Impact:** Potential security risk  
**Solution:**
- Option A: Update to latest xlsx
- Option B: Replace with exceljs
- Option C: Accept risk (not recommended)

**Estimated Time:** 2-4 hours  
**Priority:** P1

---

### 5. 172 `any` Usages

**Location:** Throughout codebase  
**Issue:** Слабая типизация

**Top Files:**
- `lib/telegram/bot.ts` — 25 `any`
- `lib/agents/*.ts` — 40 `any`
- `components/**/*.tsx` — 50 `any`
- `app/api/**/route.ts` — 30 `any`
- Other — 27 `any`

**Impact:**
- No type safety
- Potential runtime errors
- Poor IDE support

**Solution:**
1. Enable `noImplicitAny` in tsconfig
2. Fix one file at a time
3. Use `unknown` instead of `any`

**Estimated Time:** 20-30 hours  
**Priority:** P2

---

### 6. GigaChat/YandexGPT Untested

**Location:** `lib/ai/providers.ts`  
**Issue:** Провайдеры добавлены, но не протестированы

**Missing:**
- API keys
- Integration tests
- Error handling tests

**Impact:**
- Unknown if providers work
- May fail in production

**Solution:**
1. Obtain API keys
2. Add integration tests
3. Document setup process

**Estimated Time:** 4-6 hours  
**Priority:** P2

---

### 7. Legacy Tests (69 files)

**Location:** `lib/__tests__/`  
**Issue:** Старые тесты не работают с Vitest

**Files:** 69 test files  
**Status:** Excluded from vitest via `exclude: ['lib/__tests__/**']`

**Impact:**
- False sense of coverage
- Confusing for developers
- Bloated codebase

**Solution:**
- Option A: Delete all (recommended)
- Option B: Rewrite to Vitest format
- Option C: Keep as archive (current)

**Estimated Time:** 2 hours (delete) / 40 hours (rewrite)  
**Priority:** P2

---

## 🟢 Low Priority Issues (6)

### 8. Console.log Statements

**Location:** Throughout codebase  
**Issue:** Осталось ~50 console.log вместо logger

**Solution:** Replace with `logger.debug/info/warn/error`

**Estimated Time:** 2-3 hours  
**Priority:** P3

---

### 9. Hardcoded Strings

**Location:** Various components  
**Issue:** Некоторые строки не в i18n

**Examples:**
- Error messages
- Button labels
- Placeholder text

**Solution:** Move to `locales/*.json`

**Estimated Time:** 4-6 hours  
**Priority:** P3

---

### 10. Missing Error Boundaries

**Location:** Some pages  
**Issue:** Не все страницы имеют error boundaries

**Pages without:**
- `/analytics`
- `/kanban`
- `/gantt`
- `/calendar`

**Solution:** Add `error.tsx` to each route

**Estimated Time:** 1-2 hours  
**Priority:** P3

---

### 11. Inconsistent Naming

**Location:** Various files  
**Issue:** Разный стиль именования

**Examples:**
- `handleClick` vs `onClick`
- `fetchData` vs `getData`
- `isLoading` vs `loading`

**Solution:** Create style guide, apply consistently

**Estimated Time:** 4-6 hours  
**Priority:** P4

---

### 12. Missing JSDoc Comments

**Location:** Most functions  
**Issue:** Нет документации для функций

**Impact:**
- Poor IDE support
- Hard to understand code
- No auto-generated docs

**Solution:** Add JSDoc to public functions

**Estimated Time:** 8-12 hours  
**Priority:** P4

---

### 13. Recharts Warnings

**Location:** Chart components  
**Issue:** Warnings о width/height -1

```
Warning: width(-1) and height(-1) should be greater than 0
```

**Impact:** Clutters console, but charts work  
**Solution:** Fix responsive container logic

**Estimated Time:** 2-3 hours  
**Priority:** P4

---

## 📊 Debt Metrics

### Code Quality Score

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| TypeScript Strict | ❌ No | ✅ Yes | High |
| `any` Usages | 172 | 0 | High |
| Test Coverage | 60% | 80% | Medium |
| Lighthouse | 85 | 90 | Low |
| Bundle Size | 938MB | 500MB | High |

### Debt Age

| Age | Issues | Action |
|-----|--------|--------|
| < 1 week | 2 | Fix now |
| 1-2 weeks | 3 | Fix next sprint |
| > 2 weeks | 8 | Backlog |

---

## 🗓️ Debt Reduction Plan

### Sprint 1 (v0.3.0)
- [ ] Fix TypeScript errors (Issue #1)
- [ ] Optimize bundle size (Issue #2)
- [ ] Fix npm vulnerabilities (Issue #4)

### Sprint 2 (v0.4.0)
- [ ] Add E2E tests (Issue #3)
- [ ] Reduce `any` usages to <50 (Issue #5)
- [ ] Test GigaChat/YandexGPT (Issue #6)

### Sprint 3 (v0.5.0)
- [ ] Delete legacy tests (Issue #7)
- [ ] Replace console.log with logger (Issue #8)
- [ ] Add missing error boundaries (Issue #10)

### Backlog
- [ ] i18n completion (Issue #9)
- [ ] Naming consistency (Issue #11)
- [ ] JSDoc comments (Issue #12)
- [ ] Recharts warnings (Issue #13)

---

## 💡 Prevention Measures

### Code Review Checklist
- [ ] No new `any` types
- [ ] All new code has tests
- [ ] No console.log
- [ ] Error boundaries for new pages
- [ ] i18n for all strings

### CI/CD Checks
- [ ] TypeScript strict mode
- [ ] ESLint warnings = 0
- [ ] Test coverage > 80%
- [ ] Bundle size < 500MB
- [ ] Lighthouse score > 90

### Documentation
- [ ] JSDoc for all public functions
- [ ] README for each module
- [ ] Architecture decision records

---

## 📈 Debt Trend

| Week | Issues | Debt Score |
|------|--------|------------|
| Week 1 (Mar 10) | 20 | 6.5/10 |
| Week 2 (Mar 17) | 13 | 3.2/10 |
| Week 3 (Mar 24) | Target: 8 | Target: 2.0/10 |

**Improvement:** -35% issues, -51% debt score ✅

---

*Report generated: 18 марта 2026*
