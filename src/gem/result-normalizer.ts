import type { SummaryResult } from '../ai/types';

interface GeminiSummaryMetadata {
  taskId: string;
  videoId: string;
  outputLanguage: 'tr' | 'en' | 'tr-en';
  summaryLength: 'short' | 'standard' | 'detailed';
}

function headingLanguage(line: string): 'tr' | 'en' | null {
  const heading = line
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/:$/, '')
    .trim();

  if (/^(türkçe|turkish)(\s+(özet|summary))?$/i.test(heading)) return 'tr';
  if (/^(english|ingilizce|İngilizce)(\s+(summary|özet))?$/i.test(heading)) return 'en';
  return null;
}

function splitBilingualMarkdown(text: string): { tr: string; en: string } | null {
  const sections: Record<'tr' | 'en', string[]> = { tr: [], en: [] };
  let activeLanguage: 'tr' | 'en' | null = null;

  for (const line of text.split(/\r?\n/)) {
    const language = headingLanguage(line);
    if (language) {
      activeLanguage = language;
      continue;
    }
    if (activeLanguage) sections[activeLanguage].push(line);
  }

  const tr = sections.tr.join('\n').trim();
  const en = sections.en.join('\n').trim();
  return tr && en ? { tr, en } : null;
}

export function normalizeGeminiSummary(
  response: string,
  metadata: GeminiSummaryMetadata
): SummaryResult {
  const text = response.replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('EMPTY_GEMINI_RESPONSE');

  const summary = metadata.outputLanguage === 'tr'
    ? { tr: text }
    : metadata.outputLanguage === 'en'
      ? { en: text }
      : splitBilingualMarkdown(text) || { tr: text, en: text };

  return {
    schemaVersion: 1,
    taskId: metadata.taskId,
    videoId: metadata.videoId,
    providerId: 'gemini-gem',
    model: 'gemini-gem',
    outputLanguage: metadata.outputLanguage,
    summaryLength: metadata.summaryLength,
    createdAt: new Date().toISOString(),
    summary,
    keyIdeas: [],
    sections: [],
    actionItems: [],
    importantTerms: [],
    warnings: [],
    rawResponseStored: false
  };
}
