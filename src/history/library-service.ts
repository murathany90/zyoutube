import { SavedSummary, HistoryService } from '../settings/history';
import { CorrectionDB, CorrectedTranscriptRecord } from '../transcript/correction-db';
import { DictionaryDB, StudyWord } from '../dictionary/dictionary-db';

export interface VideoLibraryEntry {
  videoId: string;
  title: string;
  url: string;

  createdAt: number;
  updatedAt: number;

  savedSummary?: SavedSummary;
  correctedTranscript?: CorrectedTranscriptRecord;
  studyWords?: StudyWord[];

  studyWordCount: number;

  hasSummary: boolean;
  hasOriginalTranscript: boolean;
  hasCorrectedTranscript: boolean;
  hasStudyWords: boolean;

  summaryProviderId?: string;
  correctionModel?: string;
}

export class LibraryService {
  static async getEntries(): Promise<VideoLibraryEntry[]> {
    const [summaries, corrections, studyWords] = await Promise.all([
      HistoryService.getSummaries(),
      CorrectionDB.getAll(),
      DictionaryDB.getAllStudyWords()
    ]);

    const entryMap = new Map<string, VideoLibraryEntry>();

    // 1. Process Summaries
    for (const summary of summaries) {
      const videoId = summary.videoId;
      const hasOriginalTranscript = summary.transcript && summary.transcript.length > 0;
      
      entryMap.set(videoId, {
        videoId,
        title: summary.title,
        url: summary.url,
        createdAt: summary.date,
        updatedAt: summary.date,
        savedSummary: summary,
        studyWordCount: 0,
        hasSummary: !!summary.summary,
        hasOriginalTranscript,
        hasCorrectedTranscript: false,
        hasStudyWords: false,
        summaryProviderId: summary.summary?.providerId,
        studyWords: []
      });
    }

    // 2. Process Corrections
    for (const correction of corrections) {
      const videoId = correction.videoId;
      let entry = entryMap.get(videoId);

      if (!entry) {
        entry = {
          videoId,
          title: correction.videoTitle || 'YouTube Videosu',
          url: `https://www.youtube.com/watch?v=${videoId}`,
          createdAt: correction.createdAt,
          updatedAt: correction.updatedAt || correction.createdAt,
          studyWordCount: 0,
          hasSummary: false,
          hasOriginalTranscript: false,
          hasCorrectedTranscript: false,
          hasStudyWords: false,
          studyWords: []
        };
        entryMap.set(videoId, entry);
      }

      entry.correctedTranscript = correction;
      entry.hasCorrectedTranscript = correction.sentences && correction.sentences.length > 0;
      
      // Update original transcript flag if not already set
      if (!entry.hasOriginalTranscript) {
        const hasSourceSentences = correction.sentences.some(s => s.originalTurkish || s.originalEnglish);
        if (hasSourceSentences) {
          entry.hasOriginalTranscript = true;
        }
      }

      // Update date if newer
      const correctionDate = correction.updatedAt || correction.createdAt;
      if (correctionDate > entry.updatedAt) {
        entry.updatedAt = correctionDate;
      }

      // Overwrite title if missing or default
      if (entry.title === 'YouTube Videosu' && correction.videoTitle) {
        entry.title = correction.videoTitle;
      }

      entry.correctionModel = correction.model;
    }

    // 3. Process Study Words
    for (const word of studyWords) {
      const videoId = word.videoId;
      let entry = entryMap.get(videoId);

      if (!entry) {
        entry = {
          videoId,
          title: word.videoTitle || 'YouTube Videosu',
          url: `https://www.youtube.com/watch?v=${videoId}`,
          createdAt: word.createdAt,
          updatedAt: word.updatedAt || word.createdAt,
          studyWordCount: 0,
          hasSummary: false,
          hasOriginalTranscript: false,
          hasCorrectedTranscript: false,
          hasStudyWords: false,
          studyWords: []
        };
        entryMap.set(videoId, entry);
      }

      entry.studyWordCount += 1;
      entry.hasStudyWords = true;
      if (!entry.studyWords) entry.studyWords = [];
      entry.studyWords.push(word);

      // Update date if newer
      const wordDate = word.updatedAt || word.createdAt;
      if (wordDate > entry.updatedAt) {
        entry.updatedAt = wordDate;
      }

      // Overwrite title if missing or default
      if (entry.title === 'YouTube Videosu' && word.videoTitle) {
        entry.title = word.videoTitle;
      }
    }

    // Convert map to array and sort by updatedAt desc
    const sortedEntries = Array.from(entryMap.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return sortedEntries;
  }

  static async deleteVideoEntry(videoId: string): Promise<void> {
    await Promise.allSettled([
      HistoryService.deleteSummaryByVideoId(videoId),
      CorrectionDB.remove(videoId),
      DictionaryDB.removeStudyWordsByVideo(videoId)
    ]);
  }

  static async clearAll(): Promise<void> {
    await Promise.allSettled([
      HistoryService.clearHistory(),
      CorrectionDB.clear(),
      DictionaryDB.clearStudyWords()
    ]);
  }
}
