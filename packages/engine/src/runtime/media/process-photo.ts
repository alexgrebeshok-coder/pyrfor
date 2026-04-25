/**
 * Photo processing module for Pyrfor engine.
 * Wraps OpenAIVisionProvider for image analysis.
 */

import { logger } from '../../observability/logger';
import { OpenAIVisionProvider } from '../../ai/multimodal/vision';

export interface PhotoInput {
  fileUrl?: string;       // public URL (Telegram CDN URL)
  base64?: string;        // alternative
  caption?: string;       // user's text caption
  modelHint?: string;     // model identifier (helps decide whether vision is supported at all)
  openaiApiKey?: string;  // optional override for testing
}

export interface PhotoProcessResult {
  enrichedPrompt: string; // safe to pass directly to handleMessage(text=...)
  description?: string;   // raw vision description
  used: 'vision' | 'fallback';
}

export async function processPhoto(input: PhotoInput): Promise<PhotoProcessResult> {
  const { fileUrl, base64, caption, modelHint, openaiApiKey } = input;
  
  const apiKey = openaiApiKey ?? process.env.OPENAI_API_KEY;
  
  // Check if vision is available
  if (!apiKey) {
    logger.debug('[processPhoto] No OPENAI_API_KEY, using fallback');
    return {
      enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (vision-провайдер недоступен)]`,
      used: 'fallback',
    };
  }
  
  try {
    const provider = new OpenAIVisionProvider(apiKey);
    
    if (!provider.isAvailable()) {
      logger.debug('[processPhoto] Vision provider not available, using fallback');
      return {
        enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (vision-провайдер недоступен)]`,
        used: 'fallback',
      };
    }
    
    // Prepare image source
    let imageSource;
    if (fileUrl) {
      imageSource = { kind: 'url' as const, url: fileUrl };
    } else if (base64) {
      imageSource = { kind: 'base64' as const, data: base64, mimeType: 'image/jpeg' };
    } else {
      logger.warn('[processPhoto] No fileUrl or base64 provided');
      return {
        enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (изображение недоступно)]`,
        used: 'fallback',
      };
    }
    
    // Call vision provider
    const result = await provider.describe(imageSource, {
      language: 'ru',
      prompt: 'Опиши это изображение подробно. Укажи основные объекты, людей, текст и любые важные детали.',
      maxTokens: 512,
    });
    
    const description = result.description;
    logger.info('[processPhoto] Vision analysis complete', { 
      descriptionLength: description.length,
      hasCaption: Boolean(caption),
    });
    
    // Build enriched prompt
    const enrichedPrompt = `[Изображение от пользователя]\n${description}\n\n${caption ?? ''}`.trim();
    
    return {
      enrichedPrompt,
      description,
      used: 'vision',
    };
    
  } catch (err) {
    logger.warn('[processPhoto] Vision provider error, falling back', { 
      error: err instanceof Error ? err.message : String(err) 
    });
    
    return {
      enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (vision-провайдер недоступен)]`,
      used: 'fallback',
    };
  }
}
