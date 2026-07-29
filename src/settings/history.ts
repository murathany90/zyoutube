import { SummaryResult } from '../ai/types';
import { TranscriptSegment } from '../transcript/types';

export interface SavedSummary {
  id: string;
  videoId: string;
  title: string;
  url: string;
  date: number; // timestamp
  summary?: SummaryResult;
  transcript: TranscriptSegment[];
  transcriptLanguageCode?: string;
  transcriptTrackLanguage?: string;
  transcriptSourceType?: string;
  transcriptDisplayedLanguage?: 'tr' | 'en' | 'both';
}

export interface TranscriptHistoryMetadata {
  languageCode: string;
  trackLanguage?: string;
  sourceType?: string;
  displayedLanguage: 'tr' | 'en' | 'both';
}

export class HistoryService {
  private static STORAGE_KEY = 'zyoutube_history';
  private static MAX_HISTORY = 50; // Son 50 özeti sakla

  /**
   * Tüm geçmişi getir (tarihe göre azalan sırada)
   */
  static async getSummaries(): Promise<SavedSummary[]> {
    return new Promise((resolve) => {
      chrome.storage.local.get([this.STORAGE_KEY], (result) => {
        const history: SavedSummary[] = result[this.STORAGE_KEY] || [];
        resolve(history.sort((a, b) => b.date - a.date));
      });
    });
  }

  /**
   * Belirli bir özeti ID'ye (taskId) göre getir
   */
  static async getSummary(id: string): Promise<SavedSummary | null> {
    const summaries = await this.getSummaries();
    return summaries.find(s => s.id === id) || null;
  }

  /**
   * Belirli bir özeti videoId'ye göre getir
   */
  static async getSummaryByVideoId(videoId: string): Promise<SavedSummary | null> {
    const summaries = await this.getSummaries();
    return summaries.find(s => s.videoId === videoId) || null;
  }

  /**
   * Belirli bir özeti videoId'ye göre sil
   */
  static async deleteSummaryByVideoId(videoId: string): Promise<void> {
    const summaries = await this.getSummaries();
    const filtered = summaries.filter(s => s.videoId !== videoId);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: filtered }, () => {
        resolve();
      });
    });
  }

  /**
   * Yeni bir özet kaydet
   */
  static async saveSummary(
    summaryResult: SummaryResult,
    videoInfo: { videoId: string; title: string; url: string },
    transcript: TranscriptSegment[]
  ): Promise<void> {
    const summaries = await this.getSummaries();
    const existingIndex = summaries.findIndex(s => s.videoId === videoInfo.videoId);
    const existing = existingIndex >= 0 ? summaries[existingIndex] : undefined;
    const savedTranscript = transcript.length > 0
      ? transcript
      : existing?.transcript || [];

    const newSummary: SavedSummary = {
      ...existing,
      id: summaryResult.taskId || `task_${Date.now()}`,
      videoId: videoInfo.videoId,
      title: videoInfo.title || existing?.title || 'YouTube Videosu',
      url: videoInfo.url || existing?.url || `https://www.youtube.com/watch?v=${videoInfo.videoId}`,
      date: Date.now(),
      summary: summaryResult,
      transcript: savedTranscript
    };

    if (existingIndex >= 0) {
      summaries[existingIndex] = newSummary;
    } else {
      summaries.unshift(newSummary);
    }

    // Limit the history
    const trimmed = summaries.slice(0, this.MAX_HISTORY);

    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: trimmed }, () => {
        resolve();
      });
    });
  }

  /**
   * Görüntülenen orijinal transkripti videoId bazında ekler veya günceller.
   * Var olan özet ve özet görev kimliği korunur.
   */
  static async saveTranscript(
    videoInfo: { videoId: string; title: string; url: string },
    transcript: TranscriptSegment[],
    metadata: TranscriptHistoryMetadata
  ): Promise<void> {
    if (transcript.length === 0) return;

    const summaries = await this.getSummaries();
    const existingIndex = summaries.findIndex(
      summary => summary.videoId === videoInfo.videoId
    );
    const existing = existingIndex >= 0 ? summaries[existingIndex] : undefined;

    const record: SavedSummary = {
      ...existing,
      id: existing?.id || `transcript_${videoInfo.videoId}`,
      videoId: videoInfo.videoId,
      title: videoInfo.title || existing?.title || 'YouTube Videosu',
      url: videoInfo.url || existing?.url || `https://www.youtube.com/watch?v=${videoInfo.videoId}`,
      date: Date.now(),
      transcript,
      transcriptLanguageCode: metadata.languageCode,
      transcriptTrackLanguage: metadata.trackLanguage,
      transcriptSourceType: metadata.sourceType,
      transcriptDisplayedLanguage: metadata.displayedLanguage
    };

    if (existingIndex >= 0) {
      summaries[existingIndex] = record;
    } else {
      summaries.unshift(record);
    }

    const trimmed = summaries
      .sort((a, b) => b.date - a.date)
      .slice(0, this.MAX_HISTORY);

    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: trimmed }, () => {
        resolve();
      });
    });
  }

  /**
   * Belirli bir özeti sil
   */
  static async deleteSummary(id: string): Promise<void> {
    const summaries = await this.getSummaries();
    const filtered = summaries.filter(s => s.id !== id);
    
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: filtered }, () => {
        resolve();
      });
    });
  }

  /**
   * Tüm geçmişi temizle
   */
  static async clearHistory(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove([this.STORAGE_KEY], () => {
        resolve();
      });
    });
  }
}
