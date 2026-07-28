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
    const results = await Promise.allSettled([
      HistoryService.getSummaries(),
      CorrectionDB.getAll(),
      DictionaryDB.getAllStudyWords()
    ]);

    const summaries = results[0].status === 'fulfilled' ? results[0].value : [];
    const corrections = results[1].status === 'fulfilled' ? results[1].value : [];
    const studyWords = results[2].status === 'fulfilled' ? results[2].value : [];

    if (results[0].status === 'rejected') console.error('HistoryService error:', results[0].reason);
    if (results[1].status === 'rejected') console.error('CorrectionDB error:', results[1].reason);
    if (results[2].status === 'rejected') console.error('DictionaryDB error:', results[2].reason);

    const entryMap = new Map<string, VideoLibraryEntry>();

    // 1. Process Summaries
    for (const summary of summaries) {
      if (!summary || !summary.videoId) continue;
      const videoId = summary.videoId;
      const hasOriginalTranscript = summary.transcript && summary.transcript.length > 0;
      
      entryMap.set(videoId, {
        videoId,
        title: summary.title || 'YouTube Videosu',
        url: summary.url || `https://www.youtube.com/watch?v=${videoId}`,
        createdAt: summary.date || Date.now(),
        updatedAt: summary.date || Date.now(),
        savedSummary: summary,
        studyWordCount: 0,
        hasSummary: !!summary.summary,
        hasOriginalTranscript: !!hasOriginalTranscript,
        hasCorrectedTranscript: false,
        hasStudyWords: false,
        summaryProviderId: summary.summary?.providerId,
        studyWords: []
      });
    }

    // 2. Process Corrections
    for (const correction of corrections) {
      if (!correction || !correction.videoId) continue;
      const videoId = correction.videoId;
      let entry = entryMap.get(videoId);

      if (!entry) {
        entry = {
          videoId,
          title: correction.videoTitle || 'YouTube Videosu',
          url: `https://www.youtube.com/watch?v=${videoId}`,
          createdAt: correction.createdAt || Date.now(),
          updatedAt: correction.updatedAt || correction.createdAt || Date.now(),
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
      if (!entry.hasOriginalTranscript && entry.hasCorrectedTranscript) {
        const hasSourceSentences = correction.sentences.some((s: any) => s.originalTurkish || s.originalEnglish);
        if (hasSourceSentences) {
          entry.hasOriginalTranscript = true;
        }
      }

      // Update date if newer
      const correctionDate = correction.updatedAt || correction.createdAt || 0;
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
      if (!word || !word.videoId) continue;
      const videoId = word.videoId;
      let entry = entryMap.get(videoId);

      if (!entry) {
        entry = {
          videoId,
          title: word.videoTitle || 'YouTube Videosu',
          url: `https://www.youtube.com/watch?v=${videoId}`,
          createdAt: word.createdAt || Date.now(),
          updatedAt: word.updatedAt || word.createdAt || Date.now(),
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
      const wordDate = word.updatedAt || word.createdAt || 0;
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

  static async getEntry(videoId: string): Promise<VideoLibraryEntry | null> {
    const results = await Promise.allSettled([
      HistoryService.getSummaryByVideoId(videoId),
      CorrectionDB.get(videoId),
      DictionaryDB.getStudyWordsByVideo(videoId)
    ]);

    const summary = results[0].status === 'fulfilled' ? results[0].value : null;
    const correction = results[1].status === 'fulfilled' ? results[1].value : null;
    const studyWords = results[2].status === 'fulfilled' ? results[2].value : [];

    if (results[0].status === 'rejected') console.error('HistoryService error:', results[0].reason);
    if (results[1].status === 'rejected') console.error('CorrectionDB error:', results[1].reason);
    if (results[2].status === 'rejected') console.error('DictionaryDB error:', results[2].reason);

    if (!summary && !correction && (!studyWords || studyWords.length === 0)) {
      return null;
    }

    let entry: VideoLibraryEntry = {
      videoId,
      title: 'YouTube Videosu',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      createdAt: 0,
      updatedAt: 0,
      studyWordCount: 0,
      hasSummary: false,
      hasOriginalTranscript: false,
      hasCorrectedTranscript: false,
      hasStudyWords: false,
      studyWords: []
    };

    if (summary) {
      entry.title = summary.title || entry.title;
      entry.url = summary.url || entry.url;
      entry.createdAt = summary.date || Date.now();
      entry.updatedAt = summary.date || Date.now();
      entry.savedSummary = summary;
      entry.hasSummary = !!summary.summary;
      entry.hasOriginalTranscript = !!(summary.transcript && summary.transcript.length > 0);
      entry.summaryProviderId = summary.summary?.providerId;
    }

    if (correction) {
      entry.title = correction.videoTitle && entry.title === 'YouTube Videosu' ? correction.videoTitle : entry.title;
      entry.createdAt = entry.createdAt === 0 ? (correction.createdAt || Date.now()) : Math.min(entry.createdAt, correction.createdAt || Date.now());
      const correctionDate = correction.updatedAt || correction.createdAt || Date.now();
      entry.updatedAt = Math.max(entry.updatedAt, correctionDate);
      
      entry.correctedTranscript = correction;
      entry.hasCorrectedTranscript = correction.sentences && correction.sentences.length > 0;
      
      if (!entry.hasOriginalTranscript && entry.hasCorrectedTranscript) {
        const hasSourceSentences = correction.sentences.some((s: any) => s.originalTurkish || s.originalEnglish);
        if (hasSourceSentences) {
          entry.hasOriginalTranscript = true;
        }
      }
      entry.correctionModel = correction.model;
    }

    if (studyWords && studyWords.length > 0) {
      entry.hasStudyWords = true;
      entry.studyWords = studyWords;
      entry.studyWordCount = studyWords.length;
      
      const firstWord = studyWords[0];
      entry.title = firstWord.videoTitle && entry.title === 'YouTube Videosu' ? firstWord.videoTitle : entry.title;
      entry.createdAt = entry.createdAt === 0 ? (firstWord.createdAt || Date.now()) : Math.min(entry.createdAt, firstWord.createdAt || Date.now());
      
      let maxWordDate = 0;
      for (const w of studyWords) {
        const wd = w.updatedAt || w.createdAt || 0;
        if (wd > maxWordDate) maxWordDate = wd;
      }
      entry.updatedAt = Math.max(entry.updatedAt, maxWordDate);
    }

    return entry;
  }

  static async deleteVideoEntry(videoId: string): Promise<void> {
    const results = await Promise.allSettled([
      HistoryService.deleteSummaryByVideoId(videoId),
      CorrectionDB.remove(videoId),
      DictionaryDB.removeStudyWordsByVideo(videoId)
    ]);
    
    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length > 0) {
      console.warn('LibraryService.deleteVideoEntry partially failed', errors);
      throw new Error('Bir veya daha fazla kayıt silinemedi, ancak ulaşılabilenler silindi.');
    }
  }

  static async clearAll(): Promise<void> {
    const results = await Promise.allSettled([
      HistoryService.clearHistory(),
      CorrectionDB.clear(),
      DictionaryDB.clearStudyWords()
    ]);
    
    const errors = results.filter(r => r.status === 'rejected');
    if (errors.length > 0) {
      console.warn('LibraryService.clearAll partially failed', errors);
      throw new Error('Bir veya daha fazla veritabanı temizlenemedi.');
    }
  }
}
