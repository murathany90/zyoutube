import { describe, expect, it } from 'vitest';
import { normalizeGeminiSummary } from './result-normalizer';

const metadata = {
  taskId: 'task-1',
  videoId: 'video-1',
  summaryLength: 'standard' as const
};

describe('normalizeGeminiSummary', () => {
  it('puts Turkish output only in summary.tr', () => {
    const result = normalizeGeminiSummary('## Genel Özet\nTürkçe içerik', {
      ...metadata,
      outputLanguage: 'tr'
    });

    expect(result.summary.tr).toContain('Türkçe içerik');
    expect(result.summary.en).toBeUndefined();
  });

  it('puts English output only in summary.en', () => {
    const result = normalizeGeminiSummary('## Summary\nEnglish content', {
      ...metadata,
      outputLanguage: 'en'
    });

    expect(result.summary.en).toContain('English content');
    expect(result.summary.tr).toBeUndefined();
  });

  it('splits bilingual Markdown into non-empty localized fields', () => {
    const result = normalizeGeminiSummary(
      '## Türkçe Özet\nTürkçe içerik\n\n## English Summary\nEnglish content',
      { ...metadata, outputLanguage: 'tr-en' }
    );

    expect(result.summary.tr).toBe('Türkçe içerik');
    expect(result.summary.en).toBe('English content');
  });

  it('rejects an empty Gemini response', () => {
    expect(() => normalizeGeminiSummary('  \n ', {
      ...metadata,
      outputLanguage: 'tr'
    })).toThrow('EMPTY_GEMINI_RESPONSE');
  });
});
