import { SummaryRequest, SummaryResult, AIProviderId } from './types';

export class SummaryCache {
  private static readonly DB_NAME = 'zyoutube_ai_cache';
  private static readonly STORE_NAME = 'summaries';
  private static readonly DB_VERSION = 1;
  private static readonly PROMPT_VERSION = 'single-request-v3';
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };
    });

    return this.dbPromise;
  }

  private static async generateKey(
    request: SummaryRequest,
    providerId: AIProviderId,
    model: string
  ): Promise<string> {
    // Generate a simple hash from transcript segments to ensure it's the exact same transcript
    const segmentText = request.transcript.segments.map(s => s.cleanText || s.text).join('');
    const encoder = new TextEncoder();
    const data = encoder.encode(segmentText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const transcriptHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

    return [
      request.video.videoId,
      transcriptHash,
      providerId,
      model,
      request.options.length,
      request.options.outputLanguage,
      this.PROMPT_VERSION
    ].join('_');
  }

  static async get(
    request: SummaryRequest,
    providerId: AIProviderId,
    model: string
  ): Promise<SummaryResult | null> {
    try {
      const db = await this.getDB();
      const key = await this.generateKey(request, providerId, model);

      return new Promise((resolve) => {
        const transaction = db.transaction(this.STORE_NAME, 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const getRequest = store.get(key);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            resolve(getRequest.result);
          } else {
            resolve(null);
          }
        };
        getRequest.onerror = () => resolve(null);
      });
    } catch (e) {
      console.warn('Cache read error', e);
      return null;
    }
  }

  static async set(
    request: SummaryRequest,
    providerId: AIProviderId,
    model: string,
    result: SummaryResult
  ): Promise<void> {
    try {
      const db = await this.getDB();
      const key = await this.generateKey(request, providerId, model);

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const putRequest = store.put(result, key);

        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      });
    } catch (e) {
      console.warn('Cache write error', e);
    }
  }
}
