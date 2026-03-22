# Тестирование CEOClaw Dashboard

## Установка

Перед запуском тестов установите зависимости:

```bash
npm install
```

Это установит:
- **vitest** - тестовый раннер
- **@vitest/ui** - UI для просмотра тестов
- **@vitest/coverage-v8** - генерация coverage отчётов
- **@testing-library/react** - тестирование React компонентов
- **@testing-library/user-event** - симуляция пользовательских действий
- **@testing-library/jest-dom** - кастомные матчеры для DOM
- **jsdom** - симуляция DOM среды
- **@vitejs/plugin-react** - React плагин для Vite

## Запуск тестов

### Основные команды

```bash
# Запуск тестов в watch режиме
npm test

# Запуск тестов с UI интерфейсом
npm run test:ui

# Однократный запуск всех тестов
npm run test:run

# Генерация coverage отчёта
npm run test:coverage
```

### Покрытие кода (Coverage)

После запуска `npm run test:coverage` будет создана папка `coverage/` с отчётами:
- `coverage/index.html` - HTML отчёт (откройте в браузере)
- `coverage/coverage-final.json` - JSON отчёт
- Вывод в консоль с процентом покрытия

## Структура тестов

```
__tests__/
├── setup.ts              # Глобальная настройка тестов
├── utils/
│   ├── render.tsx        # Кастомный render с провайдерами
│   └── mock-data.ts      # Генераторы мок-данных
├── lib/
│   └── utils.test.ts     # Тесты утилитарных функций
├── components/
│   └── Button.test.tsx   # Тесты компонентов
└── hooks/
    └── useLocale.test.ts # Тесты хуков
```

## Написание тестов

### Пример теста утилиты

```typescript
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/lib/utils';

describe('formatCurrency', () => {
  it('форматирует числа как рубли', () => {
    expect(formatCurrency(100000)).toBe('100 000 ₽');
  });
});
```

### Пример теста компонента

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('рендерится с текстом', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });
});
```

### Пример теста хука

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocale, LocaleProvider } from '@/contexts/locale-context';
import React from 'react';

describe('useLocale', () => {
  it('возвращает текущую локаль', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(result.current.locale).toBe('ru');
  });
});
```

## Использование мок-данных

```typescript
import { createMockProject, createMockTask } from '@/__tests__/utils/mock-data';

const project = createMockProject({ name: 'Custom Project' });
const task = createMockTask({ status: 'done' });
```

## Лучшие практики

1. **Тестируйте поведение, а не реализацию**
   - ✅ Проверяйте что видит пользователь
   - ❌ Не проверяйте внутреннее состояние компонента

2. **Используйте data-testid только в крайних случаях**
   - ✅ Предпочитайте `getByRole`, `getByText`, `getByLabelText`
   - ❌ Избегайте `getByTestId` когда есть семантические альтернативы

3. **Имитируйте пользовательские действия**
   - ✅ Используйте `userEvent.click()` вместо `fireEvent`
   - ✅ Используйте `userEvent.type()` для ввода текста

4. **Очищайте побочные эффекты**
   - ✅ Тесты должны быть изолированы
   - ✅ Используйте `afterEach` для очистки

5. **Пишите понятные описания тестов**
   - ✅ "рендерит кнопку с текстом"
   - ❌ "test1"

## Отладка тестов

### Запуск конкретного файла

```bash
npm test __tests__/lib/utils.test.ts
```

### Запуск тестов по названию

```bash
npm test -t "formatCurrency"
```

### UI режим для отладки

```bash
npm run test:ui
```

Откроется браузер с интерактивным интерфейсом для просмотра и отладки тестов.

## CI/CD

Для CI/CD пайплайнов используйте:

```bash
npm run test:run
npm run test:coverage
```

Coverage порог можно настроить в `vitest.config.ts`.
