import { SummaryResult, AIProviderId } from './types';

export class ResponseParser {
  static parseAndValidate(
    rawText: string,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' }
  ): SummaryResult {
    let parsed: any = null;
    let isFallback = false;

    // 1. Try safe JSON parse
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      // 2. Try Markdown JSON block extraction
      const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = rawText.match(jsonBlockRegex);
      if (match && match[1]) {
        try {
          parsed = JSON.parse(match[1]);
        } catch (e2) {
          isFallback = true;
        }
      } else {
        // 3. Fallback if no block found
        isFallback = true;
      }
    }

    if (isFallback || !parsed) {
      // Düz metin yedeğine geç
      return this.createFallbackResult(rawText, taskId, videoId, providerId, model, options);
    }

    // Doğrulama (Sanitization)
    const sanitized = this.sanitizeParsedData(parsed, taskId, videoId, providerId, model, options);
    return sanitized;
  }

  private static sanitizeParsedData(
    data: any,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' }
  ): SummaryResult {
    // Arrays validation
    const keyIdeas = Array.isArray(data.keyIdeas) ? data.keyIdeas : [];
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];
    const importantTerms = Array.isArray(data.importantTerms) ? data.importantTerms : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];

    // Length limit for key ideas
    if (keyIdeas.length > 5) {
      keyIdeas.splice(5);
    }

    // Timestamp validation function
    const sanitizeTimestamp = (ts: any): number | null => {
      if (typeof ts === 'number' && ts >= 0) return ts;
      return null;
    };

    return {
      schemaVersion: 1,
      taskId,
      videoId,
      providerId,
      model,
      outputLanguage: options.outputLanguage,
      summaryLength: options.length,
      createdAt: new Date().toISOString(),
      
      title: typeof data.title === 'string' ? data.title : undefined,
      summary: this.sanitizeLocalizedText(data.summary),
      
      keyIdeas: keyIdeas.map((ki: any, idx: number) => ({
        id: ki?.id || `ki-${idx}`,
        title: this.sanitizeLocalizedText(ki?.title),
        description: this.sanitizeLocalizedText(ki?.description),
        startTimeMs: sanitizeTimestamp(ki?.startTimeMs),
        endTimeMs: sanitizeTimestamp(ki?.endTimeMs)
      })),
      
      sections: sections.map((sec: any, idx: number) => ({
        id: sec?.id || `sec-${idx}`,
        title: this.sanitizeLocalizedText(sec?.title),
        summary: this.sanitizeLocalizedText(sec?.summary),
        startTimeMs: sanitizeTimestamp(sec?.startTimeMs),
        endTimeMs: sanitizeTimestamp(sec?.endTimeMs)
      })),

      actionItems: actionItems.map((ai: string) => this.sanitizeLocalizedText(ai)),
      
      importantTerms: importantTerms.map((term: any) => ({
        term: typeof term?.term === 'string' ? term.term : '',
        explanation: this.sanitizeLocalizedText(term?.explanation),
        startTimeMs: sanitizeTimestamp(term?.startTimeMs)
      })),

      warnings: warnings.map((w: string) => this.sanitizeLocalizedText(w)),

      usage: data.usage || undefined,
      rawResponseStored: false
    };
  }

  private static sanitizeLocalizedText(item: any): { tr?: string; en?: string } {
    if (!item) return {};
    return {
      tr: typeof item.tr === 'string' ? item.tr : undefined,
      en: typeof item.en === 'string' ? item.en : undefined
    };
  }

  private static createFallbackResult(
    rawText: string,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' }
  ): SummaryResult {
    const textObj = options.outputLanguage === 'en' ? { en: rawText } : { tr: rawText };

    return {
      schemaVersion: 1,
      taskId,
      videoId,
      providerId,
      model,
      outputLanguage: options.outputLanguage,
      summaryLength: options.length,
      createdAt: new Date().toISOString(),
      summary: textObj,
      keyIdeas: [],
      sections: [],
      actionItems: [],
      importantTerms: [],
      warnings: [
         { tr: 'Yapılandırılmış sonuç kısmen alınamadı. Düz metin yedeği kullanılıyor.', en: 'Structured result partially failed. Falling back to plain text.' }
      ],
      rawResponseStored: false
    };
  }
}
