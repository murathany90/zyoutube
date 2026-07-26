import { describe, it, expect } from 'vitest';
import { ResponseParser } from './response-parser';
import { AIProviderId } from './types';

describe('ResponseParser', () => {
  const mockOptions = { outputLanguage: 'tr' as const, length: 'short' as const };
  const mockProvider: AIProviderId = 'openai-compatible';

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
  });
});
