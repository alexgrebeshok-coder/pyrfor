/**
 * Photo processing module for Pyrfor engine.
 * Wraps OpenAIVisionProvider for image analysis.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../../observability/logger.js';
import { OpenAIVisionProvider } from '../../ai/multimodal/vision.js';
export function processPhoto(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { fileUrl, base64, caption, modelHint, openaiApiKey } = input;
        const apiKey = openaiApiKey !== null && openaiApiKey !== void 0 ? openaiApiKey : process.env.OPENAI_API_KEY;
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
                imageSource = { kind: 'url', url: fileUrl };
            }
            else if (base64) {
                imageSource = { kind: 'base64', data: base64, mimeType: 'image/jpeg' };
            }
            else {
                logger.warn('[processPhoto] No fileUrl or base64 provided');
                return {
                    enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (изображение недоступно)]`,
                    used: 'fallback',
                };
            }
            // Call vision provider
            const result = yield provider.describe(imageSource, {
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
            const enrichedPrompt = `[Изображение от пользователя]\n${description}\n\n${caption !== null && caption !== void 0 ? caption : ''}`.trim();
            return {
                enrichedPrompt,
                description,
                used: 'vision',
            };
        }
        catch (err) {
            logger.warn('[processPhoto] Vision provider error, falling back', {
                error: err instanceof Error ? err.message : String(err)
            });
            return {
                enrichedPrompt: `[Прикреплено изображение${caption ? ': ' + caption : ''} (vision-провайдер недоступен)]`,
                used: 'fallback',
            };
        }
    });
}
