import { CorrectedBilingualSentence } from '../settings/types';

export class CorrectionResponseParser {
  private static extractBalancedJson(text: string, startChar: '{' | '['): string | null {
    let searchIndex = 0;
    while (true) {
      const startIndex = text.indexOf(startChar, searchIndex);
      if (startIndex === -1) return null;

      const endChar = startChar === '{' ? '}' : ']';
      let bracketCount = 0;
      let inString = false;
      let escaped = false;
      let foundEndIndex = -1;

      for (let i = startIndex; i < text.length; i++) {
        const char = text[i];
        
        if (!escaped && char === '"') {
          inString = !inString;
        }
        
        if (!inString) {
          if (char === startChar) bracketCount++;
          else if (char === endChar) bracketCount--;
        }

        if (char === '\\' && !escaped) {
          escaped = true;
        } else {
          escaped = false;
        }

        if (bracketCount === 0) {
          foundEndIndex = i;
          break;
        }
      }

      if (foundEndIndex !== -1) {
        const candidate = text.substring(startIndex, foundEndIndex + 1);
        try {
          JSON.parse(candidate);
          return candidate; // Geçerli bir JSON bulundu
        } catch {
          // Parse edilemedi, aramaya devam et
        }
      }
      searchIndex = startIndex + 1;
    }
  }

  static parse(jsonStr: string, finishReason?: string): CorrectedBilingualSentence[] {
    let data: any = null;

    // 1. Doğrudan parse denemesi
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      // ignore
    }

    // 2. Markdown json code block
    if (!data) {
      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        try { data = JSON.parse(jsonMatch[1]); } catch (e) { /* ignore */ }
      }
    }

    // 3. Genel code block
    if (!data) {
      const codeMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch && codeMatch[1]) {
        try { data = JSON.parse(codeMatch[1]); } catch (e) { /* ignore */ }
      }
    }

    // 4. Dengeli Object veya Array çıkarma (string-aware)
    if (!data) {
      const objStart = jsonStr.indexOf('{');
      const arrStart = jsonStr.indexOf('[');
      
      let extractTarget: string | null = null;
      if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
        extractTarget = this.extractBalancedJson(jsonStr, '{');
      } else if (arrStart !== -1) {
        extractTarget = this.extractBalancedJson(jsonStr, '[');
      }
      
      if (extractTarget) {
        try { data = JSON.parse(extractTarget); } catch (e) { /* ignore */ }
      }
    }

    if (!data) {
      const safePreview = jsonStr.substring(0, 300).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      throw new Error(`Düzeltme sonucu JSON olarak ayrıştırılamadı.\nYanıt tipi: string\nFinish reason: ${finishReason || 'bilinmiyor'}\nYanıt önizlemesi: ${safePreview}`);
    }
    
    // Eğer array ise sarmala
    if (Array.isArray(data)) {
      data = { sentences: data };
    }

    if (!data.sentences || !Array.isArray(data.sentences)) {
      const safePreview = JSON.stringify(data).substring(0, 300).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      throw new Error(`API yanıtında sentences dizisi bulunamadı.\nYanıt tipi: object\nFinish reason: ${finishReason || 'bilinmiyor'}\nYanıt önizlemesi: ${safePreview}`);
    }

    try {
      const sentences: CorrectedBilingualSentence[] = data.sentences.map((s: any, index: number) => {
        if (!s.sourceSegmentIds || !Array.isArray(s.sourceSegmentIds) || s.sourceSegmentIds.length === 0) {
           throw new Error(`Cümle ${index} eksik veya boş sourceSegmentIds içeriyor.`);
        }
        if (!s.sourceSegmentIds.every((id: any) => typeof id === 'string')) {
           throw new Error(`Cümle ${index} sourceSegmentIds dizisi string olmayan öğeler içeriyor.`);
        }
        if (typeof s.correctedTurkish !== 'string' || s.correctedTurkish.trim() === '') {
           throw new Error(`Cümle ${index} eksik veya boş correctedTurkish içeriyor.`);
        }
        if (typeof s.correctedEnglish !== 'string' || s.correctedEnglish.trim() === '') {
           throw new Error(`Cümle ${index} eksik veya boş correctedEnglish içeriyor.`);
        }
        
        const rawConfidence = Number(s.confidence);
        const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 1;
        
        return {
          id: `corrected-${index}-${Date.now()}`,
          startTimeMs: 0,
          endTimeMs: 0,
          sourceSegmentIds: s.sourceSegmentIds,
          originalTurkish: '',
          originalEnglish: '',
          correctedTurkish: s.correctedTurkish,
          correctedEnglish: s.correctedEnglish,
          sourceLanguage: 'tr',
          confidence: confidence
        };
      });

      return sentences;
    } catch (e: any) {
      throw new Error(`Düzeltme sonucu işlenirken hata oluştu: ${e.message}`);
    }
  }

  static enrichCorrectedSentences(
    apiSentences: CorrectedBilingualSentence[],
    sourceSegments: Array<{
      id: string;
      startTimeMs: number;
      endTimeMs: number;
      turkish: string;
      english: string;
    }>,
    sourceLanguage: 'tr' | 'en'
  ): CorrectedBilingualSentence[] {
    const usedSegmentIds = new Set<string>();
    const missingSegments: string[] = [];
    const repeatedSegments: string[] = [];
    let lastSegmentIndex = -1;

    // Create segment map for fast lookup
    const segmentMap = new Map(sourceSegments.map((s, idx) => [s.id, { ...s, index: idx }]));

    const enriched = apiSentences.map((sentence) => {
      let minStart = Infinity;
      let maxEnd = -Infinity;
      const trParts: string[] = [];
      const enParts: string[] = [];

      for (const segId of sentence.sourceSegmentIds) {
        if (!segmentMap.has(segId)) {
          throw new Error(`Bilinmeyen kaynak segment ID kullanıldı: ${segId}`);
        }

        if (usedSegmentIds.has(segId)) {
          throw new Error(`Aynı kaynak segment birden fazla kez kullanıldı: ${segId}`);
        }
        usedSegmentIds.add(segId);

        const seg = segmentMap.get(segId)!;
        
        // Check order
        if (seg.index <= lastSegmentIndex) {
          throw new Error(`Kaynak segment sırası bozuk: ${segId}`);
        }
        lastSegmentIndex = seg.index;

        if (seg.startTimeMs < minStart) minStart = seg.startTimeMs;
        if (seg.endTimeMs > maxEnd) maxEnd = seg.endTimeMs;
        
        if (seg.turkish) trParts.push(seg.turkish);
        if (seg.english) enParts.push(seg.english);
      }

      sentence.startTimeMs = minStart !== Infinity ? minStart : 0;
      sentence.endTimeMs = maxEnd !== -Infinity ? maxEnd : 0;
      sentence.originalTurkish = trParts.join(' ');
      sentence.originalEnglish = enParts.join(' ');
      sentence.sourceLanguage = sourceLanguage;

      if (sentence.confidence !== undefined) {
        sentence.confidence = Math.max(0, Math.min(1, sentence.confidence));
      } else {
        sentence.confidence = 1.0;
      }

      return sentence;
    });

    for (const seg of sourceSegments) {
      if (!usedSegmentIds.has(seg.id)) {
        missingSegments.push(seg.id);
      }
    }

    if (missingSegments.length > 0 || repeatedSegments.length > 0) {
      throw new Error(`Düzeltme sonucu geçersiz: ${missingSegments.length} kaynak segment eksik, ${repeatedSegments.length} segment tekrar kullanılmış.`);
    }

    return enriched;
  }
}
