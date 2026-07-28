import { CorrectedBilingualSentence } from '../settings/types';

export const PROMPT_VERSION_CORRECTION = "bilingual-sentence-v2";

export interface CorrectedTranscriptRecord {
  videoId: string;
  videoTitle?: string;
  sourceLanguage: string;
  sourceTrackLanguage?: string;
  sourceTranscriptHash?: string;
  promptVersion?: string;
  model?: string;
  sentences: CorrectedBilingualSentence[];
  createdAt: number;
  updatedAt?: number;
}

export class CorrectionDB {
  private static readonly DB_NAME = 'zyoutube_correction_db';
  private static readonly STORE_NAME = 'corrected_transcripts';
  private static readonly DB_VERSION = 1;
  private static readonly STORAGE_PREFIX = 'corrected_transcript_';
  private static dbPromise: Promise<IDBDatabase> | null = null;

  private static hasSharedStorage(): boolean {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
  }

  private static storageKey(videoId: string): string {
    return `${this.STORAGE_PREFIX}${videoId}`;
  }

  private static getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'videoId' });
        }
      };
    });

    return this.dbPromise;
  }

  static async get(videoId: string): Promise<CorrectedTranscriptRecord | null> {
    if (this.hasSharedStorage()) {
      try {
        const key = this.storageKey(videoId);
        const data = await chrome.storage.local.get(key);
        const sharedRecord = data[key] as CorrectedTranscriptRecord | undefined;
        if (sharedRecord) return sharedRecord;
      } catch (error) {
        console.warn('CorrectionDB shared get error', error);
      }
    }

    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(this.STORE_NAME, 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const getRequest = store.get(videoId);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            resolve(getRequest.result);
          } else {
            resolve(null);
          }
        };
        getRequest.onerror = () => resolve(null);
      });
    } catch (error) {
      console.error('CorrectionDB get error', error);
      return null;
    }
  }

  static async getAll(): Promise<CorrectedTranscriptRecord[]> {
    let sharedRecords: CorrectedTranscriptRecord[] = [];
    if (this.hasSharedStorage()) {
      try {
        const data = await chrome.storage.local.get(null);
        sharedRecords = Object.entries(data)
          .filter(([key, value]) =>
            key.startsWith(this.STORAGE_PREFIX) &&
            Boolean((value as CorrectedTranscriptRecord | undefined)?.videoId)
          )
          .map(([, value]) => value as CorrectedTranscriptRecord);
      } catch (error) {
        console.warn('CorrectionDB shared getAll error', error);
      }
    }

    let legacyRecords: CorrectedTranscriptRecord[] = [];
    try {
      const db = await this.getDB();
      legacyRecords = await new Promise((resolve) => {
        const transaction = db.transaction(this.STORE_NAME, 'readonly');
        const store = transaction.objectStore(this.STORE_NAME);
        const getRequest = store.getAll();

        getRequest.onsuccess = () => {
          resolve(
            (getRequest.result as any[])?.filter(
              r => r && r.videoId && r.sentences
            ) as CorrectedTranscriptRecord[] || []
          );
        };
        getRequest.onerror = () => resolve([]);
      });
    } catch (error) {
      console.error('CorrectionDB getAll error', error);
    }

    const recordsByVideoId = new Map(
      legacyRecords.map(record => [record.videoId, record])
    );
    for (const record of sharedRecords) {
      recordsByVideoId.set(record.videoId, record);
    }

    return Array.from(recordsByVideoId.values()).sort(
      (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
    );
  }

  static async set(record: CorrectedTranscriptRecord): Promise<void> {
    try {
      if (this.hasSharedStorage()) {
        await chrome.storage.local.set({
          [this.storageKey(record.videoId)]: record
        });
        return;
      }

      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const putRequest = store.put(record);

        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      });
    } catch (e) {
      console.warn('CorrectionDB write error', e);
      throw e;
    }
  }

  static async remove(videoId: string): Promise<void> {
    try {
      if (this.hasSharedStorage()) {
        await chrome.storage.local.remove(this.storageKey(videoId));
      }

      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.delete(videoId);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('CorrectionDB remove error', e);
    }
  }

  static async clear(): Promise<void> {
    try {
      if (this.hasSharedStorage()) {
        const data = await chrome.storage.local.get(null);
        const sharedKeys = Object.keys(data).filter(key =>
          key.startsWith(this.STORAGE_PREFIX)
        );
        if (sharedKeys.length > 0) {
          await chrome.storage.local.remove(sharedKeys);
        }
      }

      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.STORE_NAME, 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn('CorrectionDB clear error', e);
    }
  }
}
