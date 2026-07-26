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
    
    if (options.outputLanguage === 'tr' || options.outputLanguage === 'tr-en') {
      textTr = rawText;
    }
    if (options.outputLanguage === 'en' || options.outputLanguage === 'tr-en') {
      textEn = rawText;
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
