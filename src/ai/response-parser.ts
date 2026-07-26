import { SummaryResult, AIProviderId } from './types';
import { TranscriptSegment } from '../transcript/types';

export class ResponseParser {
  static parseAndValidate(
    rawText: string,
    taskId: string,
    videoId: string,
    providerId: AIProviderId,
    model: string,
    options: { outputLanguage: 'tr' | 'en' | 'tr-en'; length: 'short' | 'standard' | 'detailed' },
    _videoDurationMs?: number,
    _segments?: TranscriptSegment[]
  ): SummaryResult {
    let textTr = undefined;
    let textEn = undefined;
    let parsedJson: any = null;

    try {
      parsedJson = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match && match[1]) {
        try {
          parsedJson = JSON.parse(match[1]);
        } catch { /* ignore */ }
      }
    }

    if (parsedJson && typeof parsedJson === 'object') {
      textTr = parsedJson.summary?.tr;
      textEn = parsedJson.summary?.en;
      
      return {
        schemaVersion: 1,
        taskId,
        videoId,
        providerId,
        model,
        outputLanguage: options.outputLanguage,
        summaryLength: options.length,
        createdAt: new Date().toISOString(),
        summary: {
          tr: textTr,
          en: textEn
        },
        keyIdeas: parsedJson.keyIdeas || [],
        sections: parsedJson.sections || [],
        actionItems: parsedJson.actionItems || [],
        importantTerms: parsedJson.importantTerms || [],
        warnings: parsedJson.warnings || [],
        rawResponseStored: true
      };
    }

    // Fallback to markdown text
    if (options.outputLanguage === 'tr' || options.outputLanguage === 'tr-en') {
      textTr = rawText;
    }
    if (options.outputLanguage === 'en') {
      textEn = rawText;
    }
    if (options.outputLanguage === 'tr-en' && !textEn) {
      // If dual was requested but we only have raw text, we just put it in TR so it displays.
      // Or we can leave EN empty since we can't reliably split it.
    }

    return {
      schemaVersion: 1,
      taskId,
      videoId,
      providerId,
      model,
      outputLanguage: options.outputLanguage,
      summaryLength: options.length,
      createdAt: new Date().toISOString(),
      summary: {
        tr: textTr,
        en: textEn
      },
      keyIdeas: [],
      sections: [],
      actionItems: [],
      importantTerms: [],
      warnings: [],
      rawResponseStored: true
    };
  }
}
