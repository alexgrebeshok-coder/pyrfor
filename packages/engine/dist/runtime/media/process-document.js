/**
 * Document processing module for Pyrfor engine.
 * Parses PDF/DOCX/XLSX/PPTX into markdown-ish text.
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
const MAX_TEXT_LENGTH = 50000;
/**
 * Determine document format from filename extension.
 */
function detectFormat(filename) {
    var _a;
    const ext = (_a = filename.toLowerCase().match(/\.([^.]+)$/)) === null || _a === void 0 ? void 0 : _a[1];
    switch (ext) {
        case 'pdf':
            return 'pdf';
        case 'docx':
        case 'doc':
            return 'docx';
        case 'xlsx':
        case 'xls':
            return 'xlsx';
        case 'pptx':
        case 'ppt':
            return 'pptx';
        case 'txt':
        case 'md':
        case 'csv':
        case 'json':
        case 'ts':
        case 'js':
        case 'py':
        case 'yaml':
        case 'yml':
        case 'toml':
            return 'text';
        default:
            return 'unknown';
    }
}
/**
 * Parse PDF document using pdf-parse (lazy loaded).
 */
function parsePdf(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const pdfParse = yield import('pdf-parse');
            const parseFunction = pdfParse.default || pdfParse;
            const data = yield parseFunction(buffer);
            return data.text;
        }
        catch (err) {
            logger.warn('[processDocument] PDF parsing failed', {
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    });
}
/**
 * Parse DOCX document using mammoth (lazy loaded).
 */
function parseDocx(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const mammoth = yield import('mammoth');
            const result = yield mammoth.extractRawText({ buffer });
            return result.value;
        }
        catch (err) {
            logger.warn('[processDocument] DOCX parsing failed', {
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    });
}
/**
 * Parse XLSX document using xlsx (lazy loaded).
 */
function parseXlsx(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const XLSX = yield import('xlsx');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheets = [];
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                const csv = XLSX.utils.sheet_to_csv(sheet);
                sheets.push(`## ${sheetName}\n\n${csv}`);
            }
            return sheets.join('\n\n');
        }
        catch (err) {
            logger.warn('[processDocument] XLSX parsing failed', {
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        }
    });
}
/**
 * Parse PPTX document (try xlsx first, as it sometimes works).
 */
function parsePptx(buffer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Try xlsx first (sometimes works for PPTX)
            const XLSX = yield import('xlsx');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            if (workbook.SheetNames.length > 0) {
                const sheets = [];
                for (const sheetName of workbook.SheetNames) {
                    const sheet = workbook.Sheets[sheetName];
                    const csv = XLSX.utils.sheet_to_csv(sheet);
                    if (csv.trim()) {
                        sheets.push(`## ${sheetName}\n\n${csv}`);
                    }
                }
                if (sheets.length > 0) {
                    return sheets.join('\n\n');
                }
            }
        }
        catch (_a) {
            // Fallback to placeholder
        }
        logger.warn('[processDocument] PPTX parsing not fully supported, returning placeholder');
        return '[Презентация PPTX — полный парсинг не поддерживается]';
    });
}
/**
 * Main document processing function.
 */
export function processDocument(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { buffer, filename, mimeType } = input;
        const format = detectFormat(filename);
        let extractedText = '';
        try {
            switch (format) {
                case 'pdf':
                    extractedText = yield parsePdf(buffer);
                    break;
                case 'docx':
                    extractedText = yield parseDocx(buffer);
                    break;
                case 'xlsx':
                    extractedText = yield parseXlsx(buffer);
                    break;
                case 'pptx':
                    extractedText = yield parsePptx(buffer);
                    break;
                case 'text':
                    extractedText = buffer.toString('utf-8');
                    break;
                case 'unknown':
                    const sizeKB = Math.round(buffer.length / 1024);
                    extractedText = `[Файл ${filename} (формат не поддерживается, ${sizeKB} KB)]`;
                    break;
            }
        }
        catch (err) {
            logger.warn('[processDocument] Document parsing failed completely', {
                filename,
                format,
                error: err instanceof Error ? err.message : String(err)
            });
            const sizeKB = Math.round(buffer.length / 1024);
            extractedText = `[Файл ${filename} (не удалось обработать, ${sizeKB} KB)]`;
            return {
                enrichedPrompt: `[Содержимое файла ${filename}]\n${extractedText}`,
                extractedTextLength: extractedText.length,
                format: 'unknown',
                truncated: false,
            };
        }
        // Truncate if needed
        const truncated = extractedText.length > MAX_TEXT_LENGTH;
        if (truncated) {
            extractedText = extractedText.slice(0, MAX_TEXT_LENGTH) + '\n\n[... текст обрезан до 50000 символов]';
        }
        const enrichedPrompt = `[Содержимое файла ${filename}]\n${extractedText}`;
        logger.info('[processDocument] Document processed', {
            filename,
            format,
            extractedLength: extractedText.length,
            truncated,
        });
        return {
            enrichedPrompt,
            extractedTextLength: extractedText.length,
            format,
            truncated,
        };
    });
}
