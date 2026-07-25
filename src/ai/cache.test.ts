import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummaryCache } from './cache';

// Mock indexedDB for unit testing
const mockIDBStore = new Map();
const mockIDB = {
  open: vi.fn(() => {
    const req: any = {};
    setTimeout(() => {
      req.result = {
        transaction: () => ({
          objectStore: () => ({
            get: (key: string) => {
              const getReq: any = {};
              setTimeout(() => {
                getReq.result = mockIDBStore.get(key);
                getReq.onsuccess();
              }, 0);
              return getReq;
            },
            put: (val: any, key: string) => {
              const putReq: any = {};
              setTimeout(() => {
                mockIDBStore.set(key, val);
                putReq.onsuccess();
              }, 0);
              return putReq;
            }
          })
        })
      };
      req.onsuccess();
    }, 0);
    return req;
  })
};

vi.stubGlobal('indexedDB', mockIDB);

describe('SummaryCache', () => {
  beforeEach(() => {
    mockIDBStore.clear();
  });

  const dummyRequest: any = {
    video: { videoId: 'vid1' },
    transcript: { segments: [{ text: 'hello' }] },
    options: { length: 'short', outputLanguage: 'tr' }
  };

  it('should return null if cache miss', async () => {
    const res = await SummaryCache.get(dummyRequest, 'openai-compatible', 'model1');
    expect(res).toBeNull();
  });

  it('should return result if cache hit', async () => {
    const dummyResult: any = { title: 'Cached Summary' };
    await SummaryCache.set(dummyRequest, 'openai-compatible', 'model1', dummyResult);

    const res = await SummaryCache.get(dummyRequest, 'openai-compatible', 'model1');
    expect(res).not.toBeNull();
    expect(res?.title).toBe('Cached Summary');
  });
});
