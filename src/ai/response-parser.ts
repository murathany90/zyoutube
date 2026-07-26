import { SummaryResult, AIProviderId } from './types';
import { TranscriptSegment } from '../transcript/types';

function sanitizeString(str: any, maxLength: number = 2000): string | undefined {
  if (typeof str !== 'string') return undefined;
  if (str.length > maxLength) return str.substring(0, maxLength) + '...';
  return str;
}

export class ResponseParser {
  static parseAndValidate(
    rawText: string,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' },
    videoDurationMs?: number,
    segments?: TranscriptSegment[]
  ): SummaryResult {
    let parsed: any = null;
    let isFallback = false;

    const reviver = (key: string, value: any) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined; // Prevent prototype pollution
      }
      return value;
    };

    // 1. Try safe JSON parse
    try {
      parsed = JSON.parse(rawText, reviver);
    } catch (e) {
      // 2. Try Markdown JSON block extraction
      const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = rawText.match(jsonBlockRegex);
      if (match && match[1]) {
        try {
          parsed = JSON.parse(match[1], reviver);
        } catch (e2) {
          isFallback = true;
        }
      } else {
        // 3. Fallback if no block found
        isFallback = true;
      }
    }

    if (isFallback || !parsed || typeof parsed !== 'object') {
      // Düz metin yedeğine geç
      return this.createFallbackResult(rawText, taskId, videoId, providerId, model, options);
    }

    // Doğrulama (Sanitization)
    return this.sanitizeParsedData(parsed, taskId, videoId, providerId, model, options, videoDurationMs, segments);
  }

  private static sanitizeParsedData(
    data: any,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' },
    videoDurationMs?: number,
    segments?: TranscriptSegment[]
  ): SummaryResult {
    // Arrays validation
    const keyIdeas = Array.isArray(data.keyIdeas) ? data.keyIdeas : [];
    const sections = Array.isArray(data.sections) ? data.sections : [];
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems : [];
    const importantTerms = Array.isArray(data.importantTerms) ? data.importantTerms : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];

    // Limits
    if (keyIdeas.length > 5) keyIdeas.splice(5);
    if (sections.length > 20) sections.splice(20);
    if (actionItems.length > 15) actionItems.splice(15);
    if (importantTerms.length > 15) importantTerms.splice(15);
    if (warnings.length > 5) warnings.splice(5);

    // Timestamp validation function
    const sanitizeTimestamp = (ts: any): number | null => {
      if (typeof ts !== 'number' || isNaN(ts) || !isFinite(ts) || ts < 0) return null;
      if (videoDurationMs && ts > videoDurationMs) return null;
      
      // Proximity check against segments if provided
      if (segments && segments.length > 0) {
        // Just checking if it's within the overall range roughly
        const lastSeg = segments[segments.length - 1];
        if (ts > (lastSeg.endTimeMs || lastSeg.startTimeMs) + 60000) return null; // 1 minute leeway
      }
      return ts;
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
      
      title: sanitizeString(data.title),
      summary: this.sanitizeLocalizedText(data.summary),
      
      keyIdeas: keyIdeas.map((ki: any, idx: number) => ({
        id: sanitizeString(ki?.id, 100) || `ki-${idx}`,
        title: this.sanitizeLocalizedText(ki?.title),
        description: this.sanitizeLocalizedText(ki?.description),
        startTimeMs: sanitizeTimestamp(ki?.startTimeMs),
        endTimeMs: sanitizeTimestamp(ki?.endTimeMs)
      })),
      
      sections: sections.map((sec: any, idx: number) => ({
        id: sanitizeString(sec?.id, 100) || `sec-${idx}`,
        title: this.sanitizeLocalizedText(sec?.title),
        summary: this.sanitizeLocalizedText(sec?.summary),
        startTimeMs: sanitizeTimestamp(sec?.startTimeMs),
        endTimeMs: sanitizeTimestamp(sec?.endTimeMs)
      })),

      actionItems: actionItems.map((ai: string) => this.sanitizeLocalizedText(ai)),
      
      importantTerms: importantTerms.map((term: any) => ({
        term: sanitizeString(term?.term, 500) || '',
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
      tr: sanitizeString(item.tr),
      en: sanitizeString(item.en)
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
      rawResponseStored: true
    };
  }
}
