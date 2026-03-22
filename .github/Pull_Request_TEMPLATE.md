# Pull Request Template

## 🎯 Required Checks

Before merging, all PRs must:

- [ ] **All tests pass** (`npm run test`)
- [ ] **No TypeScript errors** (`npm run build`)
- [ ] **Code coverage ≥ 70%** (checked automatically)
- [ ] **No console.log in production** (ESLint rule)
- [ ] **All API routes have authentication** (manual check)

## 📋 Checklist

- [ ] Tests written for new features
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] No breaking changes

## 🔍 Review Guidelines

### Code Quality
- TypeScript strict mode enabled
- ESLint rules followed
- No `any` types without justification
- Error handling implemented

### Security
- All API routes use `authorizeRequest`
- No secrets in code
- Input validation with Zod

### Performance
- No N+1 database queries in loops
- Proper indexing
- Caching implemented where needed

### Testing
- Unit tests for critical paths
- E2E tests for user flows
- Mock external dependencies

## 🚫 What NOT to do

- Don't skip tests
- Don't disable ESLint rules
- Don't commit console.log
- Don't ignore TypeScript errors
- Don't bypass authentication
