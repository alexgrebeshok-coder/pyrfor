// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the vision module before importing
const mockDescribe = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('../../ai/multimodal/vision', () => {
  return {
    OpenAIVisionProvider: vi.fn().mockImplementation(() => {
      return {
        isAvailable: mockIsAvailable,
        describe: mockDescribe,
      };
    }),
  };
});

// Mock logger
vi.mock('../../observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { processPhoto } from './process-photo';
import { logger } from '../../observability/logger';

describe('processPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDescribe.mockResolvedValue({
      description: 'A beautiful sunset over the mountains with vibrant orange and purple colors.',
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    mockIsAvailable.mockReturnValue(true);
  });

  it.skip('should use vision provider when API key is available', async () => {
    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      caption: 'Check this out!',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('vision');
    expect(result.description).toContain('sunset');
    expect(result.enrichedPrompt).toContain('[Изображение от пользователя]');
    expect(result.enrichedPrompt).toContain('sunset over the mountains');
    expect(result.enrichedPrompt).toContain('Check this out!');
    expect(mockDescribe).toHaveBeenCalled();
  });

  it('should merge caption into enriched prompt', async () => {
    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      caption: 'My vacation',
      openaiApiKey: 'test-key',
    });

    expect(result.enrichedPrompt).toContain('My vacation');
  });

  it('should fallback when no API key is set', async () => {
    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      caption: 'Look at this',
    });

    expect(result.used).toBe('fallback');
    expect(result.enrichedPrompt).toContain('[Прикреплено изображение: Look at this');
    expect(result.enrichedPrompt).toContain('vision-провайдер недоступен');
    expect(result.description).toBeUndefined();
    expect(mockDescribe).not.toHaveBeenCalled();
  });

  it.skip('should fallback when vision provider throws', async () => {
    mockDescribe.mockRejectedValue(new Error('API error'));

    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('fallback');
    expect(result.enrichedPrompt).toContain('vision-провайдер недоступен');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Vision provider error'),
      expect.objectContaining({ error: 'API error' })
    );
  });

  it.skip('should handle photo without caption', async () => {
    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('vision');
    expect(result.enrichedPrompt).not.toContain('undefined');
  });

  it.skip('should handle base64 input', async () => {
    const result = await processPhoto({
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      caption: 'A tiny image',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('vision');
    expect(result.enrichedPrompt).toContain('A tiny image');
    expect(mockDescribe).toHaveBeenCalled();
  });

  it('should fallback when no fileUrl or base64 provided', async () => {
    const result = await processPhoto({
      caption: 'No image',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('fallback');
    expect(result.enrichedPrompt).toContain('[Прикреплено изображение: No image');
    expect(mockDescribe).not.toHaveBeenCalled();
  });

  it('should fallback when provider isAvailable returns false', async () => {
    mockIsAvailable.mockReturnValue(false);

    const result = await processPhoto({
      fileUrl: 'https://example.com/photo.jpg',
      openaiApiKey: 'test-key',
    });

    expect(result.used).toBe('fallback');
    expect(mockDescribe).not.toHaveBeenCalled();
  });
});

