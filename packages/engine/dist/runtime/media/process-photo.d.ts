/**
 * Photo processing module for Pyrfor engine.
 * Wraps OpenAIVisionProvider for image analysis.
 */
export interface PhotoInput {
    fileUrl?: string;
    base64?: string;
    caption?: string;
    modelHint?: string;
    openaiApiKey?: string;
}
export interface PhotoProcessResult {
    enrichedPrompt: string;
    description?: string;
    used: 'vision' | 'fallback';
}
export declare function processPhoto(input: PhotoInput): Promise<PhotoProcessResult>;
//# sourceMappingURL=process-photo.d.ts.map