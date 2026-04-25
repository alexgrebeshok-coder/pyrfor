// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { processDocument } from './process-document';
import { logger } from '../../observability/logger';

// Mock logger
vi.mock('../../observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('processDocument', () => {
  it('should process plain text files', async () => {
    const content = 'Hello, world!\nThis is a test.';
    const buffer = Buffer.from(content, 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'test.txt',
    });

    expect(result.format).toBe('text');
    expect(result.enrichedPrompt).toContain('[Содержимое файла test.txt]');
    expect(result.enrichedPrompt).toContain('Hello, world!');
    expect(result.extractedTextLength).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('should process markdown files', async () => {
    const content = '# Title\n\nSome markdown **bold** text.';
    const buffer = Buffer.from(content, 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'README.md',
    });

    expect(result.format).toBe('text');
    expect(result.enrichedPrompt).toContain('# Title');
    expect(result.enrichedPrompt).toContain('**bold**');
  });

  it('should process JSON files', async () => {
    const content = JSON.stringify({ key: 'value', nested: { foo: 'bar' } }, null, 2);
    const buffer = Buffer.from(content, 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'data.json',
    });

    expect(result.format).toBe('text');
    expect(result.enrichedPrompt).toContain('"key"');
    expect(result.enrichedPrompt).toContain('"value"');
  });

  it('should truncate long documents at 50K characters', async () => {
    const longContent = 'a'.repeat(60_000);
    const buffer = Buffer.from(longContent, 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'large.txt',
    });

    expect(result.format).toBe('text');
    expect(result.truncated).toBe(true);
    expect(result.extractedTextLength).toBeLessThanOrEqual(50_000 + 100); // Allow for truncation message
    expect(result.enrichedPrompt).toContain('текст обрезан до 50000 символов');
  });

  it('should handle unknown file formats gracefully', async () => {
    const buffer = Buffer.from('Some binary content', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'unknown.bin',
    });

    expect(result.format).toBe('unknown');
    expect(result.enrichedPrompt).toContain('формат не поддерживается');
    expect(result.enrichedPrompt).toContain('unknown.bin');
  });

  it('should process PDF files (mocked)', async () => {
    // Mock pdf-parse
    vi.doMock('pdf-parse', () => ({
      default: vi.fn().mockResolvedValue({
        text: 'This is extracted PDF text.\nPage 1 content.',
        numpages: 1,
      }),
    }));

    const buffer = Buffer.from('%PDF-1.4 fake pdf', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'document.pdf',
    });

    expect(result.format).toBe('pdf');
    expect(result.enrichedPrompt).toContain('[Содержимое файла document.pdf]');
    expect(result.enrichedPrompt).toContain('extracted PDF text');
  });

  it('should process DOCX files (mocked)', async () => {
    // Mock mammoth
    vi.doMock('mammoth', () => ({
      extractRawText: vi.fn().mockResolvedValue({
        value: 'This is extracted DOCX text.\nParagraph 2.',
        messages: [],
      }),
    }));

    const buffer = Buffer.from('PK fake docx', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'report.docx',
    });

    expect(result.format).toBe('docx');
    expect(result.enrichedPrompt).toContain('[Содержимое файла report.docx]');
    expect(result.enrichedPrompt).toContain('extracted DOCX text');
  });

  it('should process XLSX files (mocked)', async () => {
    // Mock xlsx
    vi.doMock('xlsx', () => {
      const mockSheet = {
        A1: { v: 'Name', t: 's' },
        B1: { v: 'Age', t: 's' },
        A2: { v: 'Alice', t: 's' },
        B2: { v: 30, t: 'n' },
      };

      return {
        read: vi.fn().mockReturnValue({
          SheetNames: ['Sheet1'],
          Sheets: {
            Sheet1: mockSheet,
          },
        }),
        utils: {
          sheet_to_csv: vi.fn().mockReturnValue('Name,Age\nAlice,30'),
        },
      };
    });

    const buffer = Buffer.from('PK fake xlsx', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'data.xlsx',
    });

    expect(result.format).toBe('xlsx');
    expect(result.enrichedPrompt).toContain('[Содержимое файла data.xlsx]');
    expect(result.enrichedPrompt).toContain('Sheet1');
  });

  it('should handle PDF parsing errors gracefully', async () => {
    // Mock pdf-parse to throw
    vi.doMock('pdf-parse', () => ({
      default: vi.fn().mockRejectedValue(new Error('Invalid PDF')),
    }));

    const buffer = Buffer.from('not a real pdf', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'broken.pdf',
    });

    expect(result.format).toBe('unknown');
    expect(result.enrichedPrompt).toContain('не удалось обработать');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should handle PPTX files with placeholder', async () => {
    // Mock xlsx to return empty for PPTX
    vi.doMock('xlsx', () => ({
      read: vi.fn().mockReturnValue({
        SheetNames: [],
        Sheets: {},
      }),
      utils: {
        sheet_to_csv: vi.fn().mockReturnValue(''),
      },
    }));

    const buffer = Buffer.from('PK fake pptx', 'utf-8');

    const result = await processDocument({
      buffer,
      filename: 'presentation.pptx',
    });

    expect(result.format).toBe('pptx');
    expect(result.enrichedPrompt).toContain('Презентация PPTX');
  });

  it('should process various code file extensions', async () => {
    const codeExtensions = ['.ts', '.js', '.py', '.yaml', '.yml', '.toml'];

    for (const ext of codeExtensions) {
      const buffer = Buffer.from('const x = 42;', 'utf-8');
      const result = await processDocument({
        buffer,
        filename: `file${ext}`,
      });

      expect(result.format).toBe('text');
      expect(result.enrichedPrompt).toContain('const x = 42');
    }
  });
});
