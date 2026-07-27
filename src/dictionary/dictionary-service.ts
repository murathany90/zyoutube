import { DictionaryDB, DictionaryWordResult } from './dictionary-db';

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export class DictionaryService {
  private static readonly TIMEOUT_MS = 10000;

  static async lookupWord(word: string, englishSentence: string, signal?: AbortSignal): Promise<DictionaryWordResult> {
    const normalizedWord = word.trim().toLowerCase();
    const cacheKey = `${normalizedWord}_${hashString(englishSentence.trim().toLowerCase())}`;

    const cached = await DictionaryDB.getCache(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.fetchFromSources(normalizedWord, signal);
    result.cacheKey = cacheKey;
    
    await DictionaryDB.setCache(result);
    return result;
  }

  private static async fetchFromSources(word: string, externalSignal?: AbortSignal): Promise<DictionaryWordResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), this.TIMEOUT_MS);
    
    let abortListener: (() => void) | null = null;
    if (externalSignal) {
      abortListener = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener('abort', abortListener);
    }

    const encodedWord = encodeURIComponent(word);
    
    const result: DictionaryWordResult = {
      cacheKey: '', 
      normalizedWord: word,
      displayWord: word,
      meaningsTr: [],
      definitionsEn: [],
      synonyms: [],
      antonyms: [],
      source: [],
      fetchedAt: Date.now()
    };

    try {
      const [dictRes, synRes, antRes, transRes] = await Promise.allSettled([
        this.fetchFreeDictionary(encodedWord, controller.signal),
        this.fetchDatamuse(encodedWord, 'rel_syn', controller.signal),
        this.fetchDatamuse(encodedWord, 'rel_ant', controller.signal),
        this.fetchMyMemory(encodedWord, controller.signal)
      ]);

      if (dictRes.status === 'fulfilled' && dictRes.value) {
        result.displayWord = dictRes.value.word || result.displayWord;
        result.phonetic = dictRes.value.phonetic;
        result.audioUrl = dictRes.value.audioUrl;
        result.definitionsEn = dictRes.value.definitions;
        result.partOfSpeech = dictRes.value.partOfSpeech;
        if (dictRes.value.synonyms) result.synonyms.push(...dictRes.value.synonyms);
        if (dictRes.value.antonyms) result.antonyms.push(...dictRes.value.antonyms);
        result.source.push('FreeDictionary');
      }

      if (synRes.status === 'fulfilled' && synRes.value) {
        result.synonyms.push(...synRes.value);
        result.source.push('Datamuse');
      }
      
      if (antRes.status === 'fulfilled' && antRes.value) {
        result.antonyms.push(...antRes.value);
      }

      if (transRes.status === 'fulfilled' && transRes.value) {
        result.meaningsTr.push(...transRes.value);
        result.source.push('MyMemory');
      }

      // Deduplicate and limit
      result.synonyms = Array.from(new Set(result.synonyms.map(s => s.toLowerCase()))).slice(0, 8);
      result.antonyms = Array.from(new Set(result.antonyms.map(a => a.toLowerCase()))).slice(0, 8);
      result.meaningsTr = Array.from(new Set(result.meaningsTr.map(m => m.toLowerCase()))).slice(0, 5);
      
      if (
        result.meaningsTr.length === 0 &&
        result.definitionsEn.length === 0 &&
        result.synonyms.length === 0 &&
        result.antonyms.length === 0
      ) {
        throw new Error('DICTIONARY_RESULT_EMPTY');
      }

    } finally {
      clearTimeout(timeoutId);
      if (externalSignal && abortListener) {
        externalSignal.removeEventListener('abort', abortListener);
      }
    }

    return result;
  }

  private static async fetchFreeDictionary(word: string, signal: AbortSignal) {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.length) return null;
    const entry = data[0];
    
    let audioUrl = '';
    let phonetic = entry.phonetic || '';
    if (entry.phonetics && entry.phonetics.length > 0) {
      const ph = entry.phonetics.find((p: any) => p.audio && p.audio.length > 0);
      if (ph) audioUrl = ph.audio;
      if (!phonetic) phonetic = entry.phonetics.find((p: any) => p.text)?.text || '';
    }

    let partOfSpeech = '';
    const definitions: string[] = [];
    const synonyms: string[] = [];
    const antonyms: string[] = [];
    
    if (entry.meanings && entry.meanings.length > 0) {
      partOfSpeech = entry.meanings[0].partOfSpeech;
      for (const m of entry.meanings) {
        if (m.definitions) {
           for (const d of m.definitions) {
             if (definitions.length < 3) definitions.push(d.definition);
           }
        }
        if (m.synonyms) synonyms.push(...m.synonyms);
        if (m.antonyms) antonyms.push(...m.antonyms);
      }
    }

    return {
      word: entry.word,
      phonetic,
      audioUrl,
      partOfSpeech,
      definitions,
      synonyms,
      antonyms
    };
  }

  private static async fetchDatamuse(word: string, rel: string, signal: AbortSignal) {
    const res = await fetch(`https://api.datamuse.com/words?${rel}=${word}&max=8`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.length) return null;
    return data.map((d: any) => d.word);
  }

  private static cleanHtmlEntities(str: string): string {
    return str.replace(/&#([0-9]{1,3});/gi, (_, numStr) => {
      return String.fromCharCode(parseInt(numStr, 10));
    }).replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'");
  }

  private static async fetchMyMemory(word: string, signal: AbortSignal) {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${word}&langpair=en|tr`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.responseData) return null;
    
    const translations = [];
    if (data.responseData.translatedText && !data.responseData.translatedText.includes('NO QUERY SPECIFIED')) {
        translations.push(this.cleanHtmlEntities(data.responseData.translatedText));
    }
    
    if (data.matches) {
       for (const m of data.matches) {
         if (m.translation && m.translation !== data.responseData.translatedText && !m.translation.includes('NO QUERY SPECIFIED')) {
             translations.push(this.cleanHtmlEntities(m.translation));
         }
       }
    }
    return translations.slice(0, 5);
  }
}
