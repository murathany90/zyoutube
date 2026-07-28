import type { TranscriptSegment } from '../transcript/types';
import type { VideoLibraryEntry } from './library-service';

export type HistoryTab = 'summary' | 'transcript' | 'corrected' | 'words';

export function getHistoryInitialTab(
  _entry: VideoLibraryEntry,
  hash: string
): HistoryTab {
  const requested = hash.replace('#', '');
  if (['summary', 'transcript', 'corrected', 'words'].includes(requested)) {
    return requested as HistoryTab;
  }
  return 'summary';
}

export function shouldShowSummaryEmptyState(
  entry: VideoLibraryEntry,
  activeTab: HistoryTab
): boolean {
  return activeTab === 'summary' && !entry.hasSummary;
}

export function getOriginalTranscriptData(
  entry: VideoLibraryEntry | null
): TranscriptSegment[] {
  if (entry?.savedSummary?.transcript?.length) {
    return entry.savedSummary.transcript;
  }

  if (entry?.correctedTranscript?.sentences) {
    return entry.correctedTranscript.sentences
      .filter(sentence =>
        Boolean(sentence.originalTurkish || sentence.originalEnglish)
      )
      .map((sentence, index) => ({
        id: sentence.id,
        sequence: index + 1,
        startTimeMs: sentence.startTimeMs,
        endTimeMs: sentence.endTimeMs,
        durationMs: Math.max(0, sentence.endTimeMs - sentence.startTimeMs),
        text: sentence.originalTurkish,
        cleanText: sentence.originalTurkish,
        secondaryText: sentence.originalEnglish,
        languageCode: sentence.sourceLanguage
      }));
  }

  return [];
}
