import { CorrectedBilingualSentence } from '../settings/types';

export class CorrectionResponseParser {
  static parse(jsonStr: string): CorrectedBilingualSentence[] {
    try {
      // Find the first { and last } to avoid markdown formatting blocks
      const startIndex = jsonStr.indexOf('{');
      const endIndex = jsonStr.lastIndexOf('}');
      if (startIndex === -1 || endIndex === -1) {
        throw new Error('Geçerli bir JSON yapısı bulunamadı.');
      }
      const cleanJson = jsonStr.slice(startIndex, endIndex + 1);
      const data = JSON.parse(cleanJson);
      
      if (!data.sentences || !Array.isArray(data.sentences)) {
        throw new Error('API yanıtında sentences dizisi bulunamadı.');
      }

      const sentences: CorrectedBilingualSentence[] = data.sentences.map((s: any, index: number) => {
        if (!s.sourceSegmentIds || !Array.isArray(s.sourceSegmentIds)) {
           throw new Error(`Cümle ${index} eksik veya geçersiz sourceSegmentIds içeriyor.`);
        }
        if (!s.correctedTurkish) {
           throw new Error(`Cümle ${index} eksik correctedTurkish içeriyor.`);
        }
        if (!s.correctedEnglish) {
           throw new Error(`Cümle ${index} eksik correctedEnglish içeriyor.`);
        }
        
        return {
          id: `corrected-${index}-${Date.now()}`,
          startTimeMs: 0, // will be computed in UI or parser
          endTimeMs: 0, // will be computed in UI or parser
          sourceSegmentIds: s.sourceSegmentIds,
          originalTurkish: '', // UI will fill this
          originalEnglish: '', // UI will fill this
          correctedTurkish: s.correctedTurkish,
          correctedEnglish: s.correctedEnglish,
          sourceLanguage: 'tr', // default, UI will overwrite
          confidence: s.confidence || 1.0
        };
      });

      return sentences;
    } catch (e: any) {
      throw new Error(`Düzeltme sonucu ayrıştırılamadı: ${e.message}`);
    }
  }
}
