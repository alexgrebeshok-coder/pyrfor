# UI Compact Plan — CEOClaw

**Цель:** Увеличить information density на 25-40% без потери читаемости

**Дата:** 2026-03-14
**Основано на:** Research топ-10 AI apps (ChatGPT, Claude, Linear, Notion, Vercel)

---

## 📊 Текущие проблемы

### Typography (критично):

| Проблема | Сейчас | Стандарт | Файлов |
|----------|--------|----------|--------|
| text-4xl | 36px | 24px (text-2xl) | 9 |
| text-3xl | 30px | 20px (text-xl) | 14 |
| text-2xl | 24px | 18px (text-lg) | 41 |

### Spacing (критично):

| Проблема | Сейчас | Стандарт | Файлов |
|----------|--------|----------|--------|
| p-6 | 24px | 16px (p-4) | 153 |
| p-4 | 16px | 12px (p-3) | 410 |
| gap-6 | 24px | 12px (gap-3) | ~50 |

### Component Heights (средне):

| Проблема | Сейчас | Стандарт | Файлов |
|----------|--------|----------|--------|
| h-10 | 40px | 36px (h-9) | ~30 |
| h-11 | 44px | 36px (h-9) | ~20 |

---

## 🎯 План изменений

### Phase 1: Typography Scale Down (высокий приоритет)

**Затронет:** 64 файла
**Риск:** Низкий (визуальные изменения)
**Время:** 15 минут

**Changes:**
```bash
# Page headers
text-4xl → text-2xl  # 36px → 24px
text-3xl → text-xl   # 30px → 20px

# Section headers
text-2xl → text-lg   # 24px → 18px
```

**Файлы:**
- `components/projects/project-detail.tsx` (4 места)
- `components/layout/domain-page-header.tsx`
- `components/layout/domain-metric-card.tsx`
- `components/calendar/*.tsx`
- `components/chat/*.tsx`
- `components/settings/settings-page.tsx`
- `components/pilot-review/pilot-review-page.tsx`

---

### Phase 2: Spacing Compact (высокий приоритет)

**Затронет:** ~500 мест в 125 файлах
**Риск:** Средний (может сломать layout)
**Время:** 20 минут

**Changes:**
```bash
# Card padding
p-6 → p-4  # 24px → 16px
p-4 → p-3  # 16px → 12px

# Gaps
gap-6 → gap-4  # 24px → 16px
gap-4 → gap-3  # 16px → 12px
```

**Безопасный подход:**
1. Заменять только в card components
2. НЕ трогать modals/dialogs (там нужно пространство)
3. НЕ трогать forms (там нужно дыхание)

**Файлы:**
- `components/ui/card.tsx` (base styles)
- `components/projects/project-card.tsx`
- `components/tasks/task-card.tsx`
- `components/analytics/*.tsx`

---

### Phase 3: Component Heights (средний приоритет)

**Затронет:** ~50 файлов
**Риск:** Низкий
**Время:** 10 минут

**Changes:**
```bash
# Buttons
h-10 → h-9  # 40px → 36px
size="default" → size="sm"  # где уместно

# Inputs
h-11 → h-9  # 44px → 36px
```

**Файлы:**
- `components/ui/button.tsx` (base height)
- `components/ui/input.tsx`
- `components/chat/chat-input.tsx`

---

### Phase 4: Sidebar Width (низкий приоритет)

**Затронет:** 3-5 файлов
**Риск:** Низкий
**Время:** 5 минут

**Changes:**
```bash
# Sidebar
w-[280px] → w-[240px]
w-[320px] → w-[260px]
```

**Файлы:**
- `components/layout/sidebar.tsx`
- `components/chat/agent-selector.tsx`

---

## ⚠️ Риски и митигация

### Риск 1: Слишком компактно (crowded)
**Митигация:**
- Не трогаем modals, forms, onboarding
- Оставляем generous spacing в критичных местах
- Тестируем после каждой phase

### Риск 2: Несогласованность (inconsistent)
**Митигация:**
- Используем sed для массовых замен
- Проверяем grep после каждой замены
- Ручной review спорных мест

### Риск 3: Сломался layout
**Митигация:**
- Git commit после каждой phase
- Build check после изменений
- Browser test визуально

---

## 📋 Execution Checklist

### Pre-flight:
- [x] Git status clean
- [ ] Dev server running (port 3000)
- [ ] Browser ready for visual check

### Phase 1: Typography:
- [ ] Найти все text-4xl, text-3xl, text-2xl
- [ ] Заменить по стандарту
- [ ] Build check
- [ ] Visual check
- [ ] Git commit

### Phase 2: Spacing:
- [ ] Найти все p-6, p-4 в cards
- [ ] Заменить по стандарту
- [ ] Build check
- [ ] Visual check
- [ ] Git commit

### Phase 3: Heights:
- [ ] Найти все h-10, h-11
- [ ] Заменить на h-9
- [ ] Build check
- [ ] Visual check
- [ ] Git commit

### Phase 4: Sidebar:
- [ ] Найти sidebar widths
- [ ] Уменьшить на 40px
- [ ] Build check
- [ ] Visual check
- [ ] Git commit

---

## 🎯 Success Metrics

| Метрика | До | После | Цель |
|---------|----|----|------|
| Info density | 60% | ? | 85% |
| Vertical scroll | Часто | ? | Редко |
| Build time | 6.6s | ? | <10s |
| Visual breakage | 0 | ? | 0 |

---

## 📝 Notes

**Что НЕ меняем:**
- Modal padding (p-6, p-8)
- Form spacing (нужно дыхание)
- Onboarding (приветственный UI)
- Error states (важно читаемость)
- Dark mode colors

**Приоритет файлов:**
1. `components/projects/` — главная страница
2. `components/chat/` — часто используется
3. `components/layout/` — везде
4. `app/` — страницы

---

**Готов к выполнению!**
