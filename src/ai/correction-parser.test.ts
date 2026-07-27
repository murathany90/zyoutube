import { describe, it, expect } from 'vitest';
import { CorrectionResponseParser } from './correction-parser';

describe('CorrectionResponseParser', () => {
  const dummySegments = [
    { id: 'seg-1', startTimeMs: 0, endTimeMs: 1000, turkish: 'A', english: 'A', sequence: 1 },
    { id: 'seg-2', startTimeMs: 1000, endTimeMs: 2000, turkish: 'B', english: 'B', sequence: 2 },
    { id: 'seg-3', startTimeMs: 2000, endTimeMs: 3000, turkish: 'C', english: 'C', sequence: 3 },
  ];

  describe('parse', () => {
    it('doğrudan JSON object', () => {
      const json = JSON.stringify({
        sentences: [
          {
            sourceSegmentIds: ['seg-1'],
            correctedTurkish: 'Merhaba',
            correctedEnglish: 'Hello',
            confidence: 0.9
          }
        ]
      });
      const res = CorrectionResponseParser.parse(json);
      expect(res).toHaveLength(1);
      expect(res[0].correctedTurkish).toBe('Merhaba');
    });

    it('doğrudan JSON array', () => {
      const json = JSON.stringify([
        {
          sourceSegmentIds: ['seg-1'],
          correctedTurkish: 'Merhaba',
          correctedEnglish: 'Hello',
          confidence: 0.9
        }
      ]);
      const res = CorrectionResponseParser.parse(json);
      expect(res).toHaveLength(1);
      expect(res[0].correctedTurkish).toBe('Merhaba');
    });

    it('json code fence', () => {
      const text = `Burada cevabınız:
\`\`\`json
{
  "sentences": [
    {
      "sourceSegmentIds": ["seg-1"],
      "correctedTurkish": "Merhaba",
      "correctedEnglish": "Hello",
      "confidence": 0.9
    }
  ]
}
\`\`\`
İyi günler!`;
      const res = CorrectionResponseParser.parse(text);
      expect(res).toHaveLength(1);
      expect(res[0].correctedTurkish).toBe('Merhaba');
    });

    it('genel code fence', () => {
      const text = `\`\`\`
{
  "sentences": [
    {
      "sourceSegmentIds": ["seg-1"],
      "correctedTurkish": "Merhaba",
      "correctedEnglish": "Hello"
    }
  ]
}
\`\`\``;
      const res = CorrectionResponseParser.parse(text);
      expect(res).toHaveLength(1);
      expect(res[0].correctedTurkish).toBe('Merhaba');
    });

    it('JSON öncesi açıklama (dengeli çıkarıcı)', () => {
      const text = `Bu bir açıklamadır {bazen parantez olur}. 
{
  "sentences": [
    {
      "sourceSegmentIds": ["seg-1"],
      "correctedTurkish": "Merhaba",
      "correctedEnglish": "Hello"
    }
  ]
}`;
      const res = CorrectionResponseParser.parse(text);
      expect(res).toHaveLength(1);
    });

    it('string içinde süslü/köşeli parantez', () => {
      const text = `bazı açıklamalar... { "sentences": [ { "sourceSegmentIds": ["seg-1"], "correctedTurkish": "a {b} [c]", "correctedEnglish": "a {b} [c]" } ] }`;
      const res = CorrectionResponseParser.parse(text);
      expect(res).toHaveLength(1);
      expect(res[0].correctedTurkish).toBe('a {b} [c]');
    });

    it('escaped quote', () => {
      const text = `{"sentences": [{"sourceSegmentIds": ["seg-1"], "correctedTurkish": "ali \\"gel\\" dedi", "correctedEnglish": "ali \\"come\\" said"}]}`;
      const res = CorrectionResponseParser.parse(text);
      expect(res[0].correctedTurkish).toBe('ali "gel" dedi');
    });

    it('boş sourceSegmentIds hatası', () => {
      const json = JSON.stringify({ sentences: [{ sourceSegmentIds: [], correctedTurkish: 'A', correctedEnglish: 'A' }] });
      expect(() => CorrectionResponseParser.parse(json)).toThrow(/eksik veya boş sourceSegmentIds/);
    });

    it('boş Türkçe/İngilizce hatası', () => {
      const jsonTr = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], correctedTurkish: '   ', correctedEnglish: 'A' }] });
      expect(() => CorrectionResponseParser.parse(jsonTr)).toThrow(/eksik veya boş correctedTurkish/);
      
      const jsonEn = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], correctedTurkish: 'A', correctedEnglish: '' }] });
      expect(() => CorrectionResponseParser.parse(jsonEn)).toThrow(/eksik veya boş correctedEnglish/);
    });

    it('confidence 0 değerinin korunması', () => {
      const json = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], correctedTurkish: 'A', correctedEnglish: 'A', confidence: 0 }] });
      const res = CorrectionResponseParser.parse(json);
      expect(res[0].confidence).toBe(0);
    });
  });

  describe('enrichCorrectedSentences', () => {
    it('başarılı eşleştirme', () => {
      const sentences = [
        { id: '1', startTimeMs: 0, endTimeMs: 0, sourceSegmentIds: ['seg-1', 'seg-2', 'seg-3'], originalTurkish: '', originalEnglish: '', correctedTurkish: 'A B C', correctedEnglish: 'A B C', sourceLanguage: 'tr' as const, confidence: 1 }
      ];
      // mock the whole segments list
      const enriched = CorrectionResponseParser.enrichCorrectedSentences(sentences, dummySegments, 'tr');
      expect(enriched[0].startTimeMs).toBe(0);
      expect(enriched[0].endTimeMs).toBe(3000);
      expect(enriched[0].originalTurkish).toBe('A B C');
    });

    it('tekrar segment hatası', () => {
      const sentences = [
        { id: '1', startTimeMs: 0, endTimeMs: 0, sourceSegmentIds: ['seg-1'], originalTurkish: '', originalEnglish: '', correctedTurkish: 'A', correctedEnglish: 'A', sourceLanguage: 'tr' as const, confidence: 1 },
        { id: '2', startTimeMs: 0, endTimeMs: 0, sourceSegmentIds: ['seg-1'], originalTurkish: '', originalEnglish: '', correctedTurkish: 'A', correctedEnglish: 'A', sourceLanguage: 'tr' as const, confidence: 1 }
      ];
      expect(() => CorrectionResponseParser.enrichCorrectedSentences(sentences, dummySegments, 'tr'))
        .toThrow(/Aynı kaynak segment birden fazla kez kullanıldı/);
    });

    it('sıra bozukluğu hatası', () => {
      const sentences = [
        { id: '1', startTimeMs: 0, endTimeMs: 0, sourceSegmentIds: ['seg-2', 'seg-1'], originalTurkish: '', originalEnglish: '', correctedTurkish: 'A', correctedEnglish: 'A', sourceLanguage: 'tr' as const, confidence: 1 }
      ];
      expect(() => CorrectionResponseParser.enrichCorrectedSentences(sentences, dummySegments, 'tr'))
        .toThrow(/Kaynak segment sırası bozuk/);
    });
  });
});
