import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocale, LocaleProvider } from '@/contexts/locale-context';
import React from 'react';

describe('useLocale', () => {
  beforeEach(() => {
    // Очищаем localStorage перед каждым тестом
    localStorage.clear();
  });

  it('возвращает текущую локаль по умолчанию (ru)', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(result.current.locale).toBe('ru');
  });

  it('предоставляет функцию перевода', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(typeof result.current.t).toBe('function');
  });

  it('предоставляет функцию смены локали', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(typeof result.current.setLocale).toBe('function');
  });

  it('позволяет сменить локаль', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    act(() => {
      result.current.setLocale('en');
    });
    
    expect(result.current.locale).toBe('en');
  });

  it('сохраняет локаль в localStorage', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    act(() => {
      result.current.setLocale('en');
    });
    
    expect(localStorage.setItem).toHaveBeenCalledWith('ceoclaw-locale', 'en');
  });

  it('предоставляет функцию форматирования дат', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(typeof result.current.formatDateLocalized).toBe('function');
  });

  it('предоставляет функцию для меток enum', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });
    
    expect(typeof result.current.enumLabel).toBe('function');
  });

  it('выбрасывает ошибку при использовании вне провайдера', () => {
    const { result } = renderHook(() => {
      try {
        useLocale();
        return null;
      } catch (error) {
        return error as Error;
      }
    });

    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toBe('useLocale must be used within LocaleProvider');
  });
});
