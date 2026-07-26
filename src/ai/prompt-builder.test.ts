import { describe, it, expect } from 'vitest';
import { PromptBuilder } from './prompt-builder';
import { SummaryRequest } from './types';

describe('PromptBuilder', () => {
  const createMockRequest = (
    lang: 'tr' | 'en' | 'tr-en',
    len: 'short' | 'standard' | 'detailed'
  ): SummaryRequest => ({
    taskId: '1',
    video: { videoId: 'v1', title: 'Test Video', url: 'http://yt' },
    transcript: {
      languageCode: 'en',
      sourceType: 'unknown',
      qualityLevel: 'medium',
      qualityReasons: [],
      segments: [
        { id: '1', sequence: 1, durationMs: 1000, languageCode: 'en', startTimeMs: 0, endTimeMs: 1000, text: 'Hello', cleanText: 'Hello' }
      ]
    },
    options: {
      length: len,
      outputLanguage: lang,
      includeKeyIdeas: true,
      includeSections: true,
      includeActionItems: false
    }
  });

  it('should include correct language instructions (TR)', () => {
    const req = createMockRequest('tr', 'standard');
    const prompt = PromptBuilder.buildSystemPrompt(req);
    expect(prompt).toContain('Yalnızca Türkçe');
    expect(prompt).not.toContain('Yalnızca İngilizce');
  });

  it('should include correct language instructions (EN)', () => {
    const req = createMockRequest('en', 'standard');
    const prompt = PromptBuilder.buildSystemPrompt(req);
    expect(prompt).toContain('Yalnızca İngilizce');
    expect(prompt).not.toContain('Yalnızca Türkçe');
  });

  it('should include correct length instructions (short)', () => {
    const req = createMockRequest('tr', 'short');
    const prompt = PromptBuilder.buildSystemPrompt(req);
    expect(prompt).toContain('ÖZET UZUNLUĞU: Kısa');
  });

  it('should build user prompt correctly', () => {
    const req = createMockRequest('tr', 'standard');
    const prompt = PromptBuilder.buildUserPrompt(req);
    expect(prompt).toContain('Başlık: Test Video');
    expect(prompt).toContain('[0:00] Hello');
  });
});
