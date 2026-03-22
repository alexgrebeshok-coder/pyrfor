import { describe, it, expect } from 'vitest';
import { formatCurrency, formatDate, initials, clamp, safePercent, slugify } from '@/lib/utils';

describe('formatCurrency', () => {
  it('форматирует числа как рубли', () => {
    expect(formatCurrency(100000)).toBe('100\xa0000\xa0₽');
  });

  it('обрабатывает ноль', () => {
    expect(formatCurrency(0)).toBe('0\xa0₽');
  });

  it('обрабатывает отрицательные числа', () => {
    expect(formatCurrency(-1000)).toBe('-1\xa0000\xa0₽');
  });

  it('форматирует с разной локалью', () => {
    expect(formatCurrency(1000, 'USD', 'en')).toBe('$1,000');
  });
});

describe('formatDate', () => {
  it('форматирует дату в русской локали', () => {
    const result = formatDate('2026-03-17');
    expect(result).toContain('мар');
  });

  it('форматирует с кастомным паттерном', () => {
    const result = formatDate('2026-03-17', 'dd.MM.yyyy');
    expect(result).toBe('17.03.2026');
  });
});

describe('initials', () => {
  it('возвращает инициалы из имени', () => {
    expect(initials('John Doe')).toBe('JD');
  });

  it('возвращает — для null', () => {
    expect(initials(null)).toBe('—');
  });

  it('возвращает — для undefined', () => {
    expect(initials(undefined)).toBe('—');
  });

  it('возвращает — для пустой строки', () => {
    expect(initials('')).toBe('—');
  });

  it('ограничивает до 2 символов', () => {
    expect(initials('John Michael Doe')).toBe('JM');
  });
});

describe('clamp', () => {
  it('ограничивает значение сверху', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('ограничивает значение снизу', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });

  it('возвращает значение в пределах', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
});

describe('safePercent', () => {
  it('вычисляет процент корректно', () => {
    expect(safePercent(50, 100)).toBe(50);
  });

  it('обрабатывает деление на ноль', () => {
    expect(safePercent(50, 0)).toBe(0);
  });

  it('округляет результат', () => {
    expect(safePercent(1, 3)).toBe(33);
  });
});

describe('slugify', () => {
  it('преобразует в нижний регистр', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('заменяет пробелы на дефисы', () => {
    expect(slugify('test string')).toBe('test-string');
  });

  it('удаляет спецсимволы', () => {
    expect(slugify('test@string!')).toBe('test-string');
  });
});
