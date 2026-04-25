/**
 * Document processing module for Pyrfor engine.
 * Parses PDF/DOCX/XLSX/PPTX into markdown-ish text.
 */

import { logger } from '../../observability/logger';

export interface DocumentInput {
  buffer: Buffer;
  filename: string;       // includes extension
  mimeType?: string;
}

export interface DocumentProcessResult {
  enrichedPrompt: string;
  extractedTextLength: number;
  format: 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text' | 'unknown';
  truncated: boolean;
}

const MAX_TEXT_LENGTH = 50_000;

/**
 * Determine document format from filename extension.
 */
function detectFormat(filename: string): DocumentProcessResult['format'] {
  const ext = filename.toLowerCase().match(/\.([^.]+)$/)?.[1];
  
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
async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = await import('pdf-parse');
    const parseFunction = (pdfParse as any).default || pdfParse;
    const data = await parseFunction(buffer);
    return data.text;
  } catch (err) {
    logger.warn('[processDocument] PDF parsing failed', { 
      error: err instanceof Error ? err.message : String(err) 
    });
    throw err;
  }
}

/**
 * Parse DOCX document using mammoth (lazy loaded).
 */
async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (err) {
    logger.warn('[processDocument] DOCX parsing failed', { 
      error: err instanceof Error ? err.message : String(err) 
    });
    throw err;
  }
}

/**
 * Parse XLSX document using xlsx (lazy loaded).
 */
async function parseXlsx(buffer: Buffer): Promise<string> {
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    const sheets: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      sheets.push(`## ${sheetName}\n\n${csv}`);
    }
    
    return sheets.join('\n\n');
  } catch (err) {
    logger.warn('[processDocument] XLSX parsing failed', { 
      error: err instanceof Error ? err.message : String(err) 
    });
    throw err;
  }
}

/**
 * Parse PPTX document (try xlsx first, as it sometimes works).
 */
async function parsePptx(buffer: Buffer): Promise<string> {
  try {
    // Try xlsx first (sometimes works for PPTX)
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    
    if (workbook.SheetNames.length > 0) {
      const sheets: string[] = [];
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
  } catch {
    // Fallback to placeholder
  }
  
  logger.warn('[processDocument] PPTX parsing not fully supported, returning placeholder');
  return '[Презентация PPTX — полный парсинг не поддерживается]';
}

/**
 * Main document processing function.
 */
export async function processDocument(input: DocumentInput): Promise<DocumentProcessResult> {
  const { buffer, filename, mimeType } = input;
  const format = detectFormat(filename);
  
  let extractedText = '';
  
  try {
    switch (format) {
      case 'pdf':
        extractedText = await parsePdf(buffer);
        break;
        
      case 'docx':
        extractedText = await parseDocx(buffer);
        break;
        
      case 'xlsx':
        extractedText = await parseXlsx(buffer);
        break;
        
      case 'pptx':
        extractedText = await parsePptx(buffer);
        break;
        
      case 'text':
        extractedText = buffer.toString('utf-8');
        break;
        
      case 'unknown':
        const sizeKB = Math.round(buffer.length / 1024);
        extractedText = `[Файл ${filename} (формат не поддерживается, ${sizeKB} KB)]`;
        break;
    }
  } catch (err) {
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
}
