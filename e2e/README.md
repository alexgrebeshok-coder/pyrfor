# E2E Tests

This directory contains end-to-end tests for the CEOClaw Dashboard using Playwright.

## Smoke Tests (`smoke.spec.ts`)

Smoke tests verify that critical user flows and pages load correctly. They are designed to be fast and catch major regressions.

### What's Tested

1. **Dashboard (Home)**
   - Page loads successfully with correct title
   - Navigation is visible

2. **Projects Page**
   - Page loads with correct heading ("Проекты" or "Projects")
   - Content area is visible

3. **Tasks Page**
   - Page loads with correct heading ("Задачи" or "Tasks")
   - Content area is visible

4. **Application Shell**
   - Theme is applied correctly (dark/light)
   - Locale is set correctly (ru/en/zh-CN)

### Running Tests

```bash
# Run smoke tests against the local production-like server
CEOCLAW_E2E_AUTH_BYPASS=true npm run test:e2e -- e2e/smoke.spec.ts

# Run post-deploy smoke checks against an already deployed URL
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy

# Run the targeted smoke/release subset used by CI
CEOCLAW_E2E_AUTH_BYPASS=true npm run test:e2e:smoke

# Run accessibility e2e explicitly
npm run test:e2e:accessibility

# Run with UI (interactive mode)
npm run test:e2e:ui -- e2e/smoke.spec.ts

# Run in debug mode
npm run test:e2e:debug -- e2e/smoke.spec.ts

# Run all e2e tests
npm run test:e2e

# Force e2e even if SKIP_E2E=true is set in the environment
npm run test:e2e:force
```

### Notes

- Tests run against `http://localhost:3000`
- Playwright automatically starts the dev server before running tests
- Authentication is bypassed in dev mode (localhost), so no login required
- Tests use Chromium by default (can be configured in `playwright.config.ts`)
- Screenshots are captured on test failures
- Traces are captured on retry attempts

### Test Timeout

Default timeout is 30 seconds per test. The app should load within 10 seconds.

### CI/CD

In CI environments:
- Tests are retried 2 times
- Tests run in a single worker (no parallelism)
- `test.only` is forbidden
- Playwright is routed through `scripts/run-e2e.mjs`
- CI reads `SKIP_E2E` / `SKIP_E2E_REASON` from GitHub repository variables
- The workflow now defaults to running the targeted smoke/release subset (`npm run test:e2e:smoke`)
- `SKIP_E2E=true` remains an explicit emergency override, not the default behavior
- Accessibility e2e is now opt-in in CI via `RUN_ACCESSIBILITY_E2E=true`
- Production deploys also run a separate HTTP-based post-deploy smoke (`npm run smoke:postdeploy`) against the URL returned by the Vercel deploy step

### Temporary note on accessibility coverage

Accessibility-oriented e2e coverage should return only after stable fixtures/baselines exist. Until then, the CI path intentionally favors predictable smoke coverage over brittle checks that generate noisy failures.

### Adding New Tests

When adding new smoke tests:
1. Focus on critical user flows
2. Keep tests fast (avoid long waits)
3. Use meaningful assertions
4. Add proper timeouts for async content
5. Update this README if testing new routes
