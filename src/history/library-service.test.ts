import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryService } from './library-service';
import { HistoryService } from '../settings/history';
import { CorrectionDB } from '../transcript/correction-db';
import { DictionaryDB } from '../dictionary/dictionary-db';

vi.mock('../settings/history', () => ({
  HistoryService: {
    getSummaries: vi.fn(),
    getSummaryByVideoId: vi.fn(),
    deleteSummaryByVideoId: vi.fn(),
    clearHistory: vi.fn(),
  }
}));

vi.mock('../transcript/correction-db', () => ({
  CorrectionDB: {
    getAll: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }
}));

vi.mock('../dictionary/dictionary-db', () => ({
  DictionaryDB: {
    getAllStudyWords: vi.fn(),
    getStudyWordsByVideo: vi.fn(),
    removeStudyWordsByVideo: vi.fn(),
    clearStudyWords: vi.fn(),
  }
}));

describe('LibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should merge independent sources into a single entry with Promise.allSettled', async () => {
    const summary = { videoId: 'v1', title: 'Video 1', url: '', date: 100, summary: { providerId: 'test' }, transcript: [{ text: 'test' }] };
    const correction = { videoId: 'v1', sentences: [{ originalTurkish: 'A', correctedTurkish: 'A' }], createdAt: 200 };
    const word = { id: 'w1', videoId: 'v2', displayWord: 'test', meaningsTr: [], englishSentence: '', turkishSentence: '', createdAt: 300 };

    vi.mocked(HistoryService.getSummaries).mockResolvedValue([summary as any]);
    vi.mocked(CorrectionDB.getAll).mockResolvedValue([correction as any]);
    vi.mocked(DictionaryDB.getAllStudyWords).mockResolvedValue([word as any]);

    const entries = await LibraryService.getEntries();
    expect(entries.length).toBe(2);
    
    const entry1 = entries.find(e => e.videoId === 'v1');
    expect(entry1?.hasSummary).toBe(true);
    expect(entry1?.hasCorrectedTranscript).toBe(true);
    expect(entry1?.hasOriginalTranscript).toBe(true);
    expect(entry1?.updatedAt).toBe(200);

    const entry2 = entries.find(e => e.videoId === 'v2');
    expect(entry2?.hasStudyWords).toBe(true);
    expect(entry2?.hasSummary).toBe(false);
  });

  it('should not fail if one source rejects', async () => {
    vi.mocked(HistoryService.getSummaries).mockRejectedValue(new Error('History fail'));
    vi.mocked(CorrectionDB.getAll).mockResolvedValue([]);
    vi.mocked(DictionaryDB.getAllStudyWords).mockResolvedValue([]);

    const entries = await LibraryService.getEntries();
    expect(entries).toEqual([]);
  });

  it('transcript-only history record appears without summary or correction', async () => {
    vi.mocked(HistoryService.getSummaries).mockResolvedValue([{
      id: 'transcript-v1',
      videoId: 'v1',
      title: 'Transcript Video',
      url: 'https://www.youtube.com/watch?v=v1',
      date: 100,
      transcript: [{ id: 's1', text: 'Merhaba', cleanText: 'Merhaba' }]
    } as any]);
    vi.mocked(CorrectionDB.getAll).mockResolvedValue([]);
    vi.mocked(DictionaryDB.getAllStudyWords).mockResolvedValue([]);

    const entries = await LibraryService.getEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      videoId: 'v1',
      hasSummary: false,
      hasOriginalTranscript: true,
      hasCorrectedTranscript: false
    });
  });

  it('should clear all databases using Promise.allSettled', async () => {
    vi.mocked(HistoryService.clearHistory).mockResolvedValue(undefined);
    vi.mocked(CorrectionDB.clear).mockRejectedValue(new Error('DB Fail'));
    vi.mocked(DictionaryDB.clearStudyWords).mockResolvedValue(undefined);

    await expect(LibraryService.clearAll()).rejects.toThrow('Bir veya daha fazla veritabanı temizlenemedi.');
    expect(HistoryService.clearHistory).toHaveBeenCalled();
    expect(DictionaryDB.clearStudyWords).toHaveBeenCalled();
  });
});
