import { CorrectedBilingualSentence } from '../settings/types';

export interface CorrectedTranscriptRecord {
  videoId: string;
  sourceLanguage: string;
  sentences: CorrectedBilingualSentence[];
  createdAt: number;
}

export class CorrectionDB {
  private static readonly DB_NAME = 'zyoutube_correction_db';
  private static readonly STORE_NAME = 'corrected_transcripts';
  private static readonly DB_VERSION = 1;
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
          db.createObjectStore(this.STORE_NAME, { keyPath: 'videoId' });
        }
      };
    });

    return this.dbPromise;
  }

  static async get(videoId: string): Promise<CorrectedTranscriptRecord | null> {
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
    } catch (e) {
      console.warn('CorrectionDB read error', e);
      return null;
    }
  }

  static async set(record: CorrectedTranscriptRecord): Promise<void> {
    try {
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
    }
  }

  static async remove(videoId: string): Promise<void> {
    try {
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
}
