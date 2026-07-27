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

    it('boş Türkçe/İngilizce durumunda parsing durmaz', () => {
      const jsonTr = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], correctedTurkish: '   ', correctedEnglish: 'A' }] });
      expect(() => CorrectionResponseParser.parse(jsonTr)).not.toThrow();
      
      const jsonEn = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], correctedTurkish: 'A', correctedEnglish: '' }] });
      expect(() => CorrectionResponseParser.parse(jsonEn)).not.toThrow();
    });

    it('alias alanlarını destekler', () => {
      const json = JSON.stringify({ sentences: [{ sourceSegmentIds: ['s1'], turkishText: 'TR_TEXT', englishText: 'EN_TEXT' }] });
      const res = CorrectionResponseParser.parse(json);
      expect(res[0].correctedTurkish).toBe('TR_TEXT');
      expect(res[0].correctedEnglish).toBe('EN_TEXT');
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

    it('en boş, originalEnglish dolu -> başarı ve fallback warning', () => {
      const segs = [{ id: 'seg-1', startTimeMs: 0, endTimeMs: 1000, turkish: 'TR', english: 'en-A' }];
      const sentences: any = [
        { index: 0, id: '1', _from: 0, _to: 0, sourceSegmentIds: ['seg-1'], correctedTurkish: 'TR', correctedEnglish: '', confidence: 1 }
      ];
      const enriched = CorrectionResponseParser.enrichCorrectedSentences(sentences, segs, 'tr');
      expect(enriched[0].correctedEnglish).toBe('en-A');
      expect(enriched[0].confidence).toBe(0.5);
      expect(enriched[0].warnings).toContain('1. cümlede yapay zekâ İngilizce çıktı üretmedi; orijinal İngilizce metin kullanıldı.');
    });

    it('tr boş, originalTurkish dolu -> başarı ve fallback warning', () => {
      const segs = [{ id: 'seg-1', startTimeMs: 0, endTimeMs: 1000, turkish: 'A', english: 'EN' }];
      const sentences: any = [
        { index: 2, id: '1', _from: 0, _to: 0, sourceSegmentIds: ['seg-1'], correctedTurkish: '', correctedEnglish: 'EN', confidence: 0.9 }
      ];
      const enriched = CorrectionResponseParser.enrichCorrectedSentences(sentences, segs, 'en');
      expect(enriched[0].correctedTurkish).toBe('A');
      expect(enriched[0].confidence).toBe(0.5);
      expect(enriched[0].warnings).toContain('3. cümlede yapay zekâ Türkçe çıktı üretmedi; orijinal Türkçe metin kullanıldı.');
    });

    it('en boş, originalEnglish de boş -> CORRECTION_LANGUAGE_MISSING', () => {
      const emptySegments = [{ id: 'seg-e', startTimeMs: 0, endTimeMs: 1000, turkish: 'TR', english: '' }];
      const sentences: any = [
        { index: 3, id: '1', _from: 0, _to: 0, sourceSegmentIds: ['seg-e'], correctedTurkish: 'TR', correctedEnglish: '' }
      ];
      try {
        CorrectionResponseParser.enrichCorrectedSentences(sentences, emptySegments, 'tr');
        expect(true).toBe(false); // Should have thrown
      } catch (err: any) {
        expect(err.code).toBe('CORRECTION_LANGUAGE_MISSING');
        expect(err.message).toContain('4. cümle için İngilizce çıktı üretilemedi');
      }
    });
  });
});
