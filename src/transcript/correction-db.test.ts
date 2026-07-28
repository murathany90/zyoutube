import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorrectionDB, type CorrectedTranscriptRecord } from './correction-db';

function createRecord(videoId: string, createdAt: number): CorrectedTranscriptRecord {
  return {
    videoId,
    sourceLanguage: 'en',
    sentences: [{
      id: `sentence-${videoId}`,
      startTimeMs: 0,
      endTimeMs: 1000,
      sourceSegmentIds: ['segment-1'],
      originalTurkish: 'Merhaba.',
      originalEnglish: 'Hello.',
      correctedTurkish: 'Merhaba.',
      correctedEnglish: 'Hello.',
      sourceLanguage: 'en'
    }],
    createdAt
  };
}

describe('CorrectionDB extension-wide storage', () => {
  const originalChrome = globalThis.chrome;
  let values: Record<string, unknown>;

  beforeEach(() => {
    values = {};
    const local = {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...values };
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested
            .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
            .map((key) => [key, values[key]])
        );
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          delete values[key];
        }
      })
    };

    vi.stubGlobal('chrome', { storage: { local } });
  });

  afterEach(() => {
    if (originalChrome) {
      vi.stubGlobal('chrome', originalChrome);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it('content ve History contextlerinin paylastigi chrome storage alanina kaydeder', async () => {
    const record = createRecord('video-1', 100);

    await CorrectionDB.set(record);

    expect(values['corrected_transcript_video-1']).toEqual(record);
    await expect(CorrectionDB.get('video-1')).resolves.toEqual(record);
  });

  it('merkezi storage yazma hatasini cagiriciya iletir', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('quota exceeded')
    );

    await expect(CorrectionDB.set(createRecord('video-2', 200))).rejects.toThrow(
      'quota exceeded'
    );
  });
});
