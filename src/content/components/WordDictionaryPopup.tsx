import React, { useEffect, useState, useRef } from 'react';
import { DictionaryService } from '../../dictionary/dictionary-service';
import { DictionaryWordResult, DictionaryDB, StudyWord } from '../../dictionary/dictionary-db';

interface WordDictionaryPopupProps {
  word: string;
  englishSentence: string;
  turkishSentence: string;
  videoId: string;
  videoTitle: string;
  timestampMs: number;
  correctedSentenceId?: string;
  position: { top: number; left: number };
  onClose: () => void;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}

export const WordDictionaryPopup: React.FC<WordDictionaryPopupProps> = ({
  word,
  englishSentence,
  turkishSentence,
  videoId,
  videoTitle,
  timestampMs,
  correctedSentenceId,
  position,
  onClose
}) => {
  const [data, setData] = useState<DictionaryWordResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const popupRef = useRef<HTMLDivElement>(null);

  const normalizedWord = word.trim().toLowerCase();
  const studyWordId = `${normalizedWord}_${hashString(englishSentence.trim().toLowerCase())}_${videoId}`;

  useEffect(() => {
    const abortController = new AbortController();

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await DictionaryService.lookupWord(word, englishSentence, abortController.signal);
        if (!abortController.signal.aborted) {
          setData(result);
        }
      } catch (e: any) {
        if (!abortController.signal.aborted) {
          setError('Sözlük bilgisi alınamadı.');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const checkSaved = async () => {
      const saved = await DictionaryDB.getStudyWord(studyWordId);
      if (saved) setIsSaved(true);
    };

    loadData();
    checkSaved();

    return () => {
      abortController.abort();
    };
  }, [word, englishSentence, studyWordId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  const toggleSave = async () => {
    if (!data) return;
    try {
      if (isSaved) {
        await DictionaryDB.removeStudyWord(studyWordId);
        setIsSaved(false);
      } else {
        const studyWord: StudyWord = {
          id: studyWordId,
          normalizedWord: data.normalizedWord,
          displayWord: data.displayWord,
          meaningsTr: data.meaningsTr,
          definitionsEn: data.definitionsEn,
          partOfSpeech: data.partOfSpeech,
          synonyms: data.synonyms,
          antonyms: data.antonyms,
          phonetic: data.phonetic,
          audioUrl: data.audioUrl,
          englishSentence,
          turkishSentence,
          videoId,
          videoTitle,
          timestampMs,
          correctedSentenceId,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        await DictionaryDB.addStudyWord(studyWord);
        setIsSaved(true);
        setSaveMessage('Kelime çalışılacak kelimelere eklendi.');
        setTimeout(() => setSaveMessage(null), 3000);
      }
    } catch (e) {
      console.error('Failed to toggle save study word', e);
    }
  };

  const playAudio = () => {
    if (data?.audioUrl) {
      new Audio(data.audioUrl).play().catch(console.error);
    }
  };

  // Keep inside viewport bounds
  const top = Math.max(10, position.top);
  const left = Math.max(10, position.left);

  return (
    <div
      ref={popupRef}
      className="absolute z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-[90%] max-w-[320px] max-h-[400px] overflow-y-auto flex flex-col"
      style={{ top, left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-3 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 flex justify-between items-start z-10">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            {data?.displayWord || word}
            {data?.partOfSpeech && (
              <span className="text-xs font-normal px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                {data.partOfSpeech}
              </span>
            )}
          </h3>
          {data?.phonetic && (
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
              {data.phonetic}
              {data.audioUrl && (
                <button onClick={playAudio} className="text-blue-500 hover:text-blue-600 p-1 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
        <button 
          onClick={toggleSave}
          disabled={!data}
          className="text-yellow-500 hover:text-yellow-600 p-1 disabled:opacity-50"
          title={isSaved ? "Çalışılacak kelimelerden çıkar" : "Çalışılacak kelimelere ekle"}
        >
          {isSaved ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          )}
        </button>
      </div>

      {saveMessage && (
        <div className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs py-1 px-3 text-center border-b border-green-200 dark:border-green-800">
          {saveMessage}
        </div>
      )}

      <div className="p-3 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-4">
            <svg className="animate-spin h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        ) : error ? (
          <div className="text-red-500 text-sm text-center py-2">{error}</div>
        ) : data ? (
          <div className="space-y-4">
            {data.meaningsTr.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Türkçe Anlamı</h4>
                <ul className="list-disc pl-4 text-sm text-gray-800 dark:text-gray-200 space-y-0.5">
                  {data.meaningsTr.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {data.definitionsEn.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">English Definition</h4>
                <ul className="list-disc pl-4 text-sm text-gray-800 dark:text-gray-200 space-y-0.5">
                  {data.definitionsEn.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {data.synonyms.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Eş Anlamlılar</h4>
                <div className="flex flex-wrap gap-1">
                  {data.synonyms.map((s, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded border border-blue-100 dark:border-blue-800">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {data.antonyms.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Zıt Anlamlılar</h4>
                <div className="flex flex-wrap gap-1">
                  {data.antonyms.map((a, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-xs rounded border border-red-100 dark:border-red-800">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Bağlam</h4>
              <div className="text-sm bg-gray-50 dark:bg-gray-700/50 p-2 rounded">
                <p className="text-gray-900 dark:text-gray-100 italic mb-1">"{englishSentence}"</p>
                <p className="text-gray-600 dark:text-gray-400">"{turkishSentence}"</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-sm text-center py-2">Sonuç bulunamadı.</div>
        )}
      </div>
    </div>
  );
};
