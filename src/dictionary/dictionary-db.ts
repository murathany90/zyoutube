export interface DictionaryWordResult {
  cacheKey: string;
  normalizedWord: string;
  displayWord: string;
  meaningsTr: string[];
  definitionsEn: string[];
  partOfSpeech?: string;
  synonyms: string[];
  antonyms: string[];
  phonetic?: string;
  audioUrl?: string;
  source: string[];
  fetchedAt: number;
}

export interface StudyWord {
  id: string;
  normalizedWord: string;
  displayWord: string;

  meaningsTr: string[];
  definitionsEn: string[];
  partOfSpeech?: string;
  synonyms: string[];
  antonyms: string[];
  phonetic?: string;
  audioUrl?: string;

  englishSentence: string;
  turkishSentence: string;

  videoId: string;
  videoTitle: string;
  timestampMs: number;
  correctedSentenceId?: string;

  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'zyoutube_dictionary';
const DB_VERSION = 1;

export class DictionaryDB {
  private static db: IDBDatabase | null = null;
  private static initPromise: Promise<void> | null = null;

  static async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('dictionaryCache')) {
          db.createObjectStore('dictionaryCache', { keyPath: 'cacheKey' });
        }
        if (!db.objectStoreNames.contains('studyWords')) {
          const studyStore = db.createObjectStore('studyWords', { keyPath: 'id' });
          studyStore.createIndex('by_videoId', 'videoId', { unique: false });
          studyStore.createIndex('by_word', 'normalizedWord', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => {
        reject(new Error('IndexedDB (DictionaryDB) failed to open.'));
      };
    });

    return this.initPromise;
  }

  static async getCache(cacheKey: string): Promise<DictionaryWordResult | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('dictionaryCache', 'readonly');
      const store = tx.objectStore('dictionaryCache');
      const request = store.get(cacheKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  static async setCache(item: DictionaryWordResult): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('dictionaryCache', 'readwrite');
      const store = tx.objectStore('dictionaryCache');
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async getStudyWord(id: string): Promise<StudyWord | null> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readonly');
      const store = tx.objectStore('studyWords');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  static async addStudyWord(word: StudyWord): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readwrite');
      const store = tx.objectStore('studyWords');
      const request = store.put(word);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async removeStudyWord(id: string): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readwrite');
      const store = tx.objectStore('studyWords');
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  static async getAllStudyWords(): Promise<StudyWord[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readonly');
      const store = tx.objectStore('studyWords');
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result as StudyWord[];
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async getStudyWordsByVideo(videoId: string): Promise<StudyWord[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readonly');
      const store = tx.objectStore('studyWords');
      // We don't have an index on videoId right now, so we filter getAll
      const request = store.getAll();
      request.onsuccess = () => {
        let results = request.result as StudyWord[];
        results = results.filter(w => w.videoId === videoId);
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async getStudyWordsByWord(normalizedWord: string): Promise<StudyWord[]> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readonly');
      const store = tx.objectStore('studyWords');
      const request = store.getAll();
      request.onsuccess = () => {
        let results = request.result as StudyWord[];
        results = results.filter(w => w.normalizedWord === normalizedWord);
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  static async removeStudyWordsByVideo(videoId: string): Promise<void> {
    const words = await this.getStudyWordsByVideo(videoId);
    await this.init();
    
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readwrite');
      const store = tx.objectStore('studyWords');
      
      let pending = words.length;
      if (pending === 0) {
        resolve();
        return;
      }
      
      let hasError = false;
      words.forEach(w => {
        const req = store.delete(w.id);
        req.onsuccess = () => {
          pending--;
          if (pending === 0 && !hasError) resolve();
        };
        req.onerror = () => {
          hasError = true;
          reject(req.error);
        };
      });
    });
  }

  static async clearStudyWords(): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction('studyWords', 'readwrite');
      const store = tx.objectStore('studyWords');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
