import { describe, it, expect } from 'vitest';
import { ResponseParser } from './response-parser';
import { AIProviderId } from './types';

describe('ResponseParser', () => {
  const mockOptions = { outputLanguage: 'tr' as const, length: 'short' as const };
  const mockProvider: AIProviderId = 'gemini-api';

  it('should parse valid JSON', () => {
    const json = JSON.stringify({
      summary: { tr: 'Geçerli bir özet' },
      keyIdeas: [
        { title: { tr: 'Fikir 1' }, description: { tr: 'Açıklama' }, startTimeMs: 1000 }
      ]
    });

    const result = ResponseParser.parseAndValidate(json, 'task1', 'video1', mockProvider, 'model', mockOptions);
    expect(result.summary.tr).toBe('Geçerli bir özet');
    expect(result.keyIdeas.length).toBe(1);
    expect(result.keyIdeas[0].startTimeMs).toBe(1000);
  });

  it('should extract JSON from markdown block', () => {
    const raw = `Burada bir metin var
\`\`\`json
{
  "summary": { "tr": "Markdown içi JSON" }
}
\`\`\`
Sonra başka metin`;

    const result = ResponseParser.parseAndValidate(raw, 'task1', 'video1', mockProvider, 'model', mockOptions);
    expect(result.summary.tr).toBe('Markdown içi JSON');
  });

  it('should fallback to plain text if invalid JSON', () => {
    const raw = 'Bu tamamen düz bir metin, json formatında değil.';
    const result = ResponseParser.parseAndValidate(raw, 'task1', 'video1', mockProvider, 'model', mockOptions);
    expect(result.summary.tr).toBe(raw);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should limit key ideas to 5', () => {
    const keyIdeas = Array(10).fill({ title: { tr: 'Fikir' } });
    const json = JSON.stringify({ summary: { tr: 'Özet' }, keyIdeas });
    const result = ResponseParser.parseAndValidate(json, 'task1', 'video1', mockProvider, 'model', mockOptions);
    expect(result.keyIdeas.length).toBe(5);
  });

  it('should sanitize invalid timestamps', () => {
    const json = JSON.stringify({
      summary: { tr: 'Özet' },
      sections: [
        { title: { tr: 'Bölüm' }, startTimeMs: -500 }, // invalid
        { title: { tr: 'Bölüm 2' }, startTimeMs: 'invalid_string' } // invalid
      ]
    });
    const result = ResponseParser.parseAndValidate(json, 'task1', 'video1', mockProvider, 'model', mockOptions);
    expect(result.sections[0].startTimeMs).toBeNull();
    expect(result.sections[1].startTimeMs).toBeNull();
  });
});
