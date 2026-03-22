import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { LocaleProvider } from '@/contexts/locale-context';

// Кастомный render с провайдерами
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <LocaleProvider>{children}</LocaleProvider>
    ),
    ...options,
  });
}

// Реэкспорт всего из RTL
export * from '@testing-library/react';
// Переопределение метода render
export { renderWithProviders as render };
