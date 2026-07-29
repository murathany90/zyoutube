import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryService, type SavedSummary } from './history';
import type { SummaryResult } from '../ai/types';
import type { TranscriptSegment } from '../transcript/types';

const storage: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn((keys: string[], callback: (result: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) result[key] = storage[key];
        callback(result);
      }),
      set: vi.fn((values: Record<string, unknown>, callback?: () => void) => {
        Object.assign(storage, values);
        callback?.();
      }),
      remove: vi.fn((keys: string[], callback?: () => void) => {
        for (const key of keys) delete storage[key];
        callback?.();
      })
    }
  }
};

function segment(id: string, text: string): TranscriptSegment {
  return {
    id,
    sequence: 1,
    startTimeMs: 0,
    endTimeMs: 1000,
    durationMs: 1000,
    text,
    cleanText: text,
    languageCode: 'tr'
  };
}

function summaryResult(): SummaryResult {
  return {
    schemaVersion: 1,
    taskId: 'summary-task',
    videoId: 'video-1',
    providerId: 'openai-compatible',
    model: 'test-model',
    outputLanguage: 'tr',
    summaryLength: 'standard',
    createdAt: new Date(0).toISOString(),
    summary: { tr: 'Mevcut özet' },
    keyIdeas: [],
    sections: [],
    actionItems: [],
    importantTerms: [],
    warnings: [],
    rawResponseStored: false
  };
}

describe('HistoryService transcript-only upsert', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage)) delete storage[key];
    vi.clearAllMocks();
    vi.stubGlobal('chrome', chromeMock);
  });

  it('transcript görüntülenince videoId ile kayıt oluşturur ve duplicate yerine günceller', async () => {
    await HistoryService.saveTranscript(
      {
        videoId: 'video-1',
        title: 'İlk başlık',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      [segment('s1', 'İlk transkript')],
      {
        languageCode: 'tr',
        trackLanguage: 'tr',
        sourceType: 'manual',
        displayedLanguage: 'tr'
      }
    );

    await HistoryService.saveTranscript(
      {
        videoId: 'video-1',
        title: 'Güncel başlık',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      [segment('s2', 'Güncel transkript')],
      {
        languageCode: 'en',
        trackLanguage: 'en',
        sourceType: 'automatic',
        displayedLanguage: 'en'
      }
    );

    const records = await HistoryService.getSummaries();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      videoId: 'video-1',
      title: 'Güncel başlık',
      transcriptLanguageCode: 'en',
      transcriptTrackLanguage: 'en',
      transcriptSourceType: 'automatic',
      transcriptDisplayedLanguage: 'en'
    });
    expect(records[0].transcript[0].cleanText).toBe('Güncel transkript');
    expect(records[0].summary).toBeUndefined();
  });

  it('transcript güncellemesi mevcut özeti korur', async () => {
    const existing: SavedSummary = {
      id: 'summary-task',
      videoId: 'video-1',
      title: 'Özetli video',
      url: 'https://www.youtube.com/watch?v=video-1',
      date: 100,
      summary: summaryResult(),
      transcript: [segment('old', 'Eski transkript')]
    };
    storage.zyoutube_history = [existing];

    await HistoryService.saveTranscript(
      {
        videoId: 'video-1',
        title: 'Özetli video',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      [segment('new', 'Yeni transkript')],
      {
        languageCode: 'tr',
        trackLanguage: 'tr',
        sourceType: 'manual',
        displayedLanguage: 'tr'
      }
    );

    const saved = await HistoryService.getSummaryByVideoId('video-1');
    expect(saved?.summary?.summary.tr).toBe('Mevcut özet');
    expect(saved?.transcript[0].cleanText).toBe('Yeni transkript');
  });

  it('özet kaydı boş transcript ile gelirse mevcut transcripti silmez', async () => {
    storage.zyoutube_history = [{
      id: 'transcript_video-1',
      videoId: 'video-1',
      title: 'Transcript video',
      url: 'https://www.youtube.com/watch?v=video-1',
      date: 100,
      transcript: [segment('saved', 'Korunacak transkript')],
      transcriptLanguageCode: 'tr'
    } satisfies SavedSummary];

    await HistoryService.saveSummary(
      summaryResult(),
      {
        videoId: 'video-1',
        title: 'Transcript video',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      []
    );

    const saved = await HistoryService.getSummaryByVideoId('video-1');
    expect(saved?.summary?.summary.tr).toBe('Mevcut özet');
    expect(saved?.transcript[0].cleanText).toBe('Korunacak transkript');
    expect(saved?.transcriptLanguageCode).toBe('tr');
  });
});
