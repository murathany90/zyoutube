import { CorrectedBilingualSentence } from '../settings/types';

export class CorrectionResponseParser {
  private static normalizeLanguageText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.join(' ').trim();
    return '';
  }

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

  private static extractBalancedJsonValues(text: string): any[] {
    const values: any[] = [];

    for (let startIndex = 0; startIndex < text.length; startIndex++) {
      const startChar = text[startIndex];
      if (startChar !== '{' && startChar !== '[') continue;

      const stack: string[] = [];
      let inString = false;
      let escaped = false;

      for (let index = startIndex; index < text.length; index++) {
        const char = text[index];

        if (inString) {
          if (char === '\\' && !escaped) {
            escaped = true;
            continue;
          }
          if (char === '"' && !escaped) inString = false;
          escaped = false;
          continue;
        }

        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === '{') stack.push('}');
        else if (char === '[') stack.push(']');
        else if (char === '}' || char === ']') {
          if (stack.pop() !== char) break;
          if (stack.length === 0) {
            try {
              values.push(JSON.parse(text.slice(startIndex, index + 1)));
              startIndex = index;
            } catch {
              // Keep scanning for the next balanced JSON value.
            }
            break;
          }
        }
      }
    }

    return values;
  }

  private static isSentenceLike(value: any): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    return (
      (
        typeof value.from === 'number' &&
        typeof value.to === 'number'
      ) ||
      Array.isArray(value.sourceSegmentIds)
    );
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
      const extractedValues = this.extractBalancedJsonValues(jsonStr);
      if (
        extractedValues.length > 0 &&
        extractedValues.every(value => this.isSentenceLike(value))
      ) {
        data = { sentences: extractedValues };
      } else if (extractedValues.length === 1) {
        data = extractedValues[0];
      }

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
    }

    if (!data) {
      throw new Error(`Düzeltme sonucu JSON olarak ayrıştırılamadı.\nYanıt tipi: string\nFinish reason: ${finishReason || 'bilinmiyor'}`);
    }
    
    // Eğer array ise sarmala
    if (Array.isArray(data)) {
      data = { sentences: data };
    } else if (this.isSentenceLike(data)) {
      data = { sentences: [data] };
    }

    if (!data.sentences || !Array.isArray(data.sentences)) {
      throw new Error(`API yanıtında sentences dizisi bulunamadı.\nYanıt tipi: object\nFinish reason: ${finishReason || 'bilinmiyor'}`);
    }

    try {
      const sentences: CorrectedBilingualSentence[] = data.sentences.map((s: any, index: number) => {
        let segmentIds: string[] = [];
        let fromIdx: number | undefined;
        let toIdx: number | undefined;

        if (s.sourceSegmentIds && Array.isArray(s.sourceSegmentIds)) {
           if (s.sourceSegmentIds.length === 0) {
             throw new Error(`Cümle ${index} eksik veya boş sourceSegmentIds içeriyor.`);
           }
           if (!s.sourceSegmentIds.every((id: any) => typeof id === 'string')) {
             throw new Error(`Cümle ${index} sourceSegmentIds dizisi string olmayan öğeler içeriyor.`);
           }
           segmentIds = s.sourceSegmentIds;
        } else if (typeof s.from === 'number' && typeof s.to === 'number') {
           if (s.from < 0 || s.to < s.from) {
             throw new Error(`Cümle ${index} geçersiz from/to aralığı içeriyor: ${s.from}-${s.to}`);
           }
           if (index === 0 && s.from !== 0) {
             throw new Error(`İlk cümle from: 0 ile başlamalıdır. Gelen: ${s.from}`);
           }
           fromIdx = s.from;
           toIdx = s.to;
        } else {
           throw new Error(`Cümle ${index} eksik from/to veya sourceSegmentIds içeriyor.`);
        }

        let trText = this.normalizeLanguageText(s.tr) || this.normalizeLanguageText(s.correctedTurkish) || this.normalizeLanguageText(s.turkish) || this.normalizeLanguageText(s.turkishText);
        let enText = this.normalizeLanguageText(s.en) || this.normalizeLanguageText(s.correctedEnglish) || this.normalizeLanguageText(s.english) || this.normalizeLanguageText(s.englishText);

        const rawConfidence = Number(s.confidence);
        const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 1;
        
        const result: any = {
          id: `corrected-${index}-${Date.now()}`,
          index,
          startTimeMs: 0,
          endTimeMs: 0,
          sourceSegmentIds: segmentIds,
          originalTurkish: '',
          originalEnglish: '',
          correctedTurkish: trText,
          correctedEnglish: enText,
          sourceLanguage: 'tr',
          confidence: confidence
        };
        
        if (fromIdx !== undefined && toIdx !== undefined) {
          result._from = fromIdx;
          result._to = toIdx;
        }
        
        return result as CorrectedBilingualSentence;
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

    const firstOutOfRangeIndex = apiSentences.findIndex(
      (sentence: any) =>
        typeof sentence?._from === 'number' &&
        sentence._from >= sourceSegments.length
    );
    if (
      firstOutOfRangeIndex >= 0 &&
      apiSentences.slice(firstOutOfRangeIndex + 1).some(
        (sentence: any) =>
          typeof sentence?._from !== 'number' ||
          sentence._from < sourceSegments.length
      )
    ) {
      throw new Error('Parça dışı cümleden sonra geçerli segment bulundu.');
    }
    const boundedApiSentences = firstOutOfRangeIndex >= 0
      ? apiSentences.slice(0, firstOutOfRangeIndex)
      : apiSentences;
    if (boundedApiSentences.length === 0) {
      throw new Error('Düzeltme sonucu geçerli segment içermiyor.');
    }

    const enriched = boundedApiSentences.map((sentenceAny: any, apiSentenceIndex) => {
      const sentence = sentenceAny as CorrectedBilingualSentence & { _from?: number; _to?: number; index?: number };
      const sentenceNumber = typeof sentence.index === 'number' ? sentence.index + 1 : lastSegmentIndex + 2;
      
      if (typeof sentence._from === 'number' && typeof sentence._to === 'number') {
        const nextSentence = boundedApiSentences[apiSentenceIndex + 1] as
          | (CorrectedBilingualSentence & { _from?: number })
          | undefined;
        if (typeof nextSentence?._from === 'number') {
          if (
            nextSentence._from <= sentence._from ||
            nextSentence._from >= sourceSegments.length
          ) {
            throw new Error(
              `Geçersiz sonraki from değeri: ${nextSentence._from}`
            );
          }
          sentence._to = nextSentence._from - 1;
        } else if (apiSentenceIndex === boundedApiSentences.length - 1) {
          sentence._to = sourceSegments.length - 1;
        }

        if (sentence._from !== lastSegmentIndex + 1) {
           throw new Error(`Cümlelerin arası kopuk veya sırası bozuk. Beklenen from: ${lastSegmentIndex + 1}, Gelen: ${sentence._from}`);
        }
        if (sentence._to >= sourceSegments.length) {
           throw new Error(`'to' değeri segment sayısından büyük: ${sentence._to}`);
        }
        sentence.sourceSegmentIds = sourceSegments.slice(sentence._from, sentence._to + 1).map(s => s.id);
      }

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
      
      const originalTurkish = trParts.join(' ').trim();
      const originalEnglish = enParts.join(' ').trim();
      
      sentence.originalTurkish = originalTurkish;
      sentence.originalEnglish = originalEnglish;
      sentence.sourceLanguage = sourceLanguage;
      sentence.warnings = [];

      let trFallback = false;
      let enFallback = false;

      if (!sentence.correctedTurkish) {
        if (!originalTurkish) {
          const error: any = new Error(`${sentenceNumber}. cümle için Türkçe çıktı üretilemedi ve kaynak Türkçe metin de bulunamadı. Aralık: ${sentence._from}-${sentence._to}.`);
          error.code = 'CORRECTION_LANGUAGE_MISSING';
          error.diagnostics = {
            sentenceNumber,
            from: sentence._from,
            to: sentence._to,
            missingLanguage: 'tr',
            returnedKeys: Object.keys(sentenceAny),
            aiTurkishLength: 0,
            aiEnglishLength: sentence.correctedEnglish?.length || 0,
            sourceTurkishLength: 0,
            sourceEnglishLength: originalEnglish.length
          };
          throw error;
        }
        sentence.correctedTurkish = originalTurkish;
        trFallback = true;
      }

      if (!sentence.correctedEnglish) {
        if (!originalEnglish) {
          const error: any = new Error(`${sentenceNumber}. cümle için İngilizce çıktı üretilemedi ve kaynak İngilizce metin de bulunamadı. Aralık: ${sentence._from}-${sentence._to}.`);
          error.code = 'CORRECTION_LANGUAGE_MISSING';
          error.diagnostics = {
            sentenceNumber,
            from: sentence._from,
            to: sentence._to,
            missingLanguage: 'en',
            returnedKeys: Object.keys(sentenceAny),
            aiTurkishLength: sentence.correctedTurkish?.length || 0,
            aiEnglishLength: 0,
            sourceTurkishLength: originalTurkish.length,
            sourceEnglishLength: 0
          };
          throw error;
        }
        sentence.correctedEnglish = originalEnglish;
        enFallback = true;
      }

      if (sentence.confidence !== undefined) {
        sentence.confidence = Math.max(0, Math.min(1, sentence.confidence));
      } else {
        sentence.confidence = 1.0;
      }

      if (trFallback) {
        sentence.confidence = Math.min(sentence.confidence, 0.5);
        sentence.warnings.push(`${sentenceNumber}. cümlede yapay zekâ Türkçe çıktı üretmedi; orijinal Türkçe metin kullanıldı.`);
      }
      
      if (enFallback) {
        sentence.confidence = Math.min(sentence.confidence, 0.5);
        sentence.warnings.push(`${sentenceNumber}. cümlede yapay zekâ İngilizce çıktı üretmedi; orijinal İngilizce metin kullanıldı.`);
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

    if (lastSegmentIndex !== sourceSegments.length - 1) {
      throw new Error(`Düzeltme sonucu geçersiz: Son cümlenin 'to' değeri son segmenti kapsamıyor. Beklenen: ${sourceSegments.length - 1}, Bulunan: ${lastSegmentIndex}`);
    }

    return enriched;
  }
}
