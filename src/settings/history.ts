import { SummaryResult } from '../ai/types';
import { TranscriptSegment } from '../transcript/types';

export interface SavedSummary {
  id: string;
  videoId: string;
  title: string;
  url: string;
  date: number; // timestamp
  summary: SummaryResult;
  transcript: TranscriptSegment[];
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
   * Yeni bir özet kaydet
   */
  static async saveSummary(
    summaryResult: SummaryResult,
    videoInfo: { videoId: string; title: string; url: string },
    transcript: TranscriptSegment[]
  ): Promise<void> {
    const summaries = await this.getSummaries();
    
    // Aynı taskId veya videoId varsa güncelle
    const existingIndex = summaries.findIndex(s => s.videoId === videoInfo.videoId);
    
    const newSummary: SavedSummary = {
      id: summaryResult.taskId || `task_${Date.now()}`,
      videoId: videoInfo.videoId,
      title: videoInfo.title,
      url: videoInfo.url,
      date: Date.now(),
      summary: summaryResult,
      transcript: transcript
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
