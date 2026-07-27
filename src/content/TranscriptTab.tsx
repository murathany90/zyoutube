import { useState, useEffect, useRef, useMemo } from 'react';
import { YouTubeTranscriptProvider, TranscriptResult, CaptionTrack } from '../transcript';
import { CorrectionDB } from '../transcript/correction-db';
import { CorrectedBilingualSentence } from '../settings/types';
import { sendRuntimeMessage } from './runtime-messenger';
import { WordDictionaryPopup } from './components/WordDictionaryPopup';

const ENABLE_DICTIONARY_POPUP = true;

const HighlightedText = ({ 
  text, 
  highlight, 
  exact,
  isEnglish,
  englishSentence,
  turkishSentence,
  timestampMs,
  correctedSentenceId,
  onWordClick
}: { 
  text: string, 
  highlight: string, 
  exact: boolean,
  isEnglish?: boolean,
  englishSentence?: string,
  turkishSentence?: string,
  timestampMs?: number,
  correctedSentenceId?: string,
  onWordClick?: (e: React.MouseEvent<HTMLSpanElement>, word: string, engSent: string, trSent: string, time: number, id?: string) => void
}) => {
  const renderClickableWords = (content: string) => {
    if (!ENABLE_DICTIONARY_POPUP || !isEnglish || !onWordClick || !englishSentence) return content;
    try {
      const wordParts = content.split(/([a-zA-Z]+(?:['’'-][a-zA-Z]+)*)/);
      return wordParts.map((wp, j) => {
        if (/^[a-zA-Z]+(?:['’'-][a-zA-Z]+)*$/.test(wp)) {
          return (
            <span
              key={j}
              className="cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 hover:underline decoration-blue-300 dark:decoration-blue-700 rounded px-0.5 -mx-0.5 transition-colors inline-block"
              onClick={(e) => onWordClick(e, wp, englishSentence, turkishSentence || '', timestampMs || 0, correctedSentenceId)}
            >
              {wp}
            </span>
          );
        }
        return <span key={j}>{wp}</span>;
      });
    } catch (err) {
      console.warn('Clickable words render error', err);
      return content;
    }
  };

  if (!highlight.trim()) {
    return <span>{renderClickableWords(text)}</span>;
  }
  
  try {
    const regexPattern = exact 
      ? `(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`
      : `(${highlight.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
      
    const parts = text.split(new RegExp(regexPattern, 'gi'));
    
    return (
      <span>
        {parts.map((part, i) => {
          const isMatch = exact 
            ? part.toLowerCase() === highlight.toLowerCase()
            : highlight.trim().split(/\s+/).some(w => w.toLowerCase() === part.toLowerCase());
            
          return isMatch ? (
            <mark key={i} className="bg-yellow-300 text-black px-0.5 rounded font-semibold">
              {renderClickableWords(part)}
            </mark>
          ) : (
            <span key={i}>{renderClickableWords(part)}</span>
          );
        })}
      </span>
    );
  } catch (e) {
    return <span>{renderClickableWords(text)}</span>;
  }
};

export const TranscriptTab = ({ videoId, onTranscriptLoaded }: { videoId: string, onTranscriptLoaded?: (result: TranscriptResult | null) => void }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [tracks, setTracks] = useState<CaptionTrack[]>([]);
  const [selectedTrackUrl, setSelectedTrackUrl] = useState<string>('');
  
  const [result, setResult] = useState<TranscriptResult | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [exactMatch, setExactMatch] = useState(false);
  
  // New States
  const [fontSize, setFontSize] = useState(14);
  const [autoSync, setAutoSync] = useState(false);
  const [displayLanguage, setDisplayLanguage] = useState<'tr' | 'en' | 'both'>('tr');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [reloadCounter, setReloadCounter] = useState(0);

  const [correctionMode, setCorrectionMode] = useState<'original' | 'corrected' | 'both'>('original');
  const [correctedSentences, setCorrectedSentences] = useState<CorrectedBilingualSentence[] | null>(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionProgress, setCorrectionProgress] = useState<{stage: string; message: string; elapsedMs: number} | null>(null);
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState<string | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [pendingCorrection, setPendingCorrection] = useState(false);
  const [, setIsCancelling] = useState(false);
  const activeCorrectionTaskIdRef = useRef<string | null>(null);

  const finishCorrectionWithError = (message: string) => {
    setIsCorrecting(false);
    setPendingCorrection(false);
    setCorrectionError(message);
    setCorrectionProgress(null);
    setIsCancelling(false);
    activeCorrectionTaskIdRef.current = null;
  };

  const [activePopup, setActivePopup] = useState<{
    word: string;
    englishSentence: string;
    turkishSentence: string;
    timestampMs: number;
    correctedSentenceId?: string;
    position: { top: number; left: number };
  } | null>(null);

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, englishSentence: string, turkishSentence: string, timestampMs: number, correctedSentenceId?: string) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    
    setActivePopup({
      word,
      englishSentence,
      turkishSentence,
      timestampMs,
      correctedSentenceId,
      position: { 
        top: e.clientY - containerRect.top + container.scrollTop + 20, 
        left: Math.min(e.clientX - containerRect.left, Math.max(0, container.clientWidth - 330))
      }
    });
  };
  
  const providerRef = useRef(new YouTubeTranscriptProvider());
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // 1. Fetch available tracks on videoId change
  useEffect(() => {
    let active = true;
    
    const initTracks = async () => {
      console.log(`[Transcript] tracks loading (videoId: ${videoId})`);
      setLoading(true);
      setError(null);
      setResult(null); // Clear result on video change
      if (onTranscriptLoaded) onTranscriptLoaded(null);
      setTracks([]);
      setSelectedTrackUrl(''); // Yeni video için url'yi sıfırla
      
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Track yükleme zaman aşımına uğradı.')), 20000);
        });
        const tracksPromise = providerRef.current.getAvailableTracks(videoId);
        const availableTracks = await Promise.race([tracksPromise, timeoutPromise]);
        
        if (active) {
          console.log(`[Transcript] tracks loaded (${availableTracks.length})`);
          if (availableTracks.length === 0) {
            setError('Bu videoda erişilebilir manuel veya otomatik altyazı bulunamadı.');
          } else {
            setTracks(availableTracks);
            setSelectedTrackUrl(availableTracks[0].baseUrl);
            console.log(`[Transcript] selected track: ${availableTracks[0].languageCode}`);
          }
        }
      } catch (err: any) {
        console.error(`[Transcript] failed`, err);
        if (active) setError(err.message || 'Kanallar yüklenirken hata oluştu.');
      } finally {
        if (active) setLoading(false);
      }
    };

    const loadCorrection = async () => {
      try {
        const record = await CorrectionDB.get(videoId);
        if (active) {
          if (record && record.promptVersion === "bilingual-sentence-v2") {
            setCorrectedSentences(record.sentences);
          } else {
            setCorrectedSentences(null);
          }
          setCorrectionMode('original');
        }
      } catch (e) {
        console.warn('CorrectionDB.get failed', e);
      }
    };

    Promise.allSettled([initTracks(), loadCorrection()]);
    
    return () => { active = false; };
  }, [videoId]);

  // Check hash when result changes
  useEffect(() => {
    if (result && correctedSentences) {
      CorrectionDB.get(videoId).then(record => {
         if (record) {
           const currentHash = result.segments.map(s => s.id).join(',');
           if (record.sourceTranscriptHash && record.sourceTranscriptHash !== currentHash) {
              setCorrectedSentences(null);
           }
         }
      });
    }
  }, [result]);

  // Listener for Correction API
  useEffect(() => {
    const listener = (message: any) => {
      if (!activeCorrectionTaskIdRef.current || message.taskId !== activeCorrectionTaskIdRef.current) return;
      
      if (message.type === 'CORRECTION_COMPLETED') {
        setCorrectionProgress({ stage: 'saving', message: 'Düzeltilmiş transkript kaydediliyor...', elapsedMs: 0 });
        const enrichedSentences = message.result.sentences;

        const currentHash = result?.segments.map(s => s.id).join(',');
        const title = document.querySelector('title')?.textContent?.replace('- YouTube', '').trim() || 'Video';
        const srcLang = result?.segments[0]?.languageCode?.startsWith('tr') ? 'tr' : 'en';

        CorrectionDB.set({
          videoId,
          videoTitle: title,
          sourceLanguage: srcLang,
          sourceTrackLanguage: result?.segments[0]?.languageCode || 'tr',
          sourceTranscriptHash: currentHash,
          promptVersion: 'bilingual-sentence-v2',
          sentences: enrichedSentences,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }).then(() => {
          setIsCorrecting(false);
          setPendingCorrection(false);
          setCorrectionProgress(null);
          setIsCancelling(false);
          activeCorrectionTaskIdRef.current = null;
          setCorrectedSentences(enrichedSentences);
          setCorrectionMode('both');
          
          const warningCount = enrichedSentences.reduce((sum: number, s: any) => sum + (s.warnings?.length ? 1 : 0), 0);
          if (warningCount > 0) {
            setCorrectionSuccessMsg(`Düzeltme tamamlandı. ${warningCount} cümlede eksik AI alanı için orijinal metin korundu.`);
          } else {
            setCorrectionSuccessMsg(`Düzeltme tamamlandı: ${enrichedSentences.length} anlamlı çift dilli cümle oluşturuldu.`);
          }
          setTimeout(() => setCorrectionSuccessMsg(null), 5000);
        }).catch(console.error);

      } else if (message.type === 'CORRECTION_FAILED') {
        const error = message.error;
        if (error) {
          console.groupCollapsed(`[ZYouTube Correction] ${error.code || 'UNKNOWN'} — ${error.stage || 'unknown'}`);
          console.error(error.userMessage || 'Düzeltme başarısız.');
          console.table(error.diagnostics || {});
          console.groupEnd();
        }
        finishCorrectionWithError(error?.userMessage || 'Düzeltme başarısız.');
      } else if (message.type === 'CORRECTION_PROGRESS') {
        setCorrectionProgress({
          stage: message.stage,
          message: message.message,
          elapsedMs: message.elapsedMs
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [videoId]);

  // 2. Fetch transcript when selectedTrackUrl or language changes
  const [dualLangWarning, setDualLangWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTrackUrl) return;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    let active = true;
    const fetchTranscripts = async () => {
      setLoading(true);
      setError(null);
      setDualLangWarning(null);
      let onParentAbort: (() => void) | null = null;
      try {
        console.log(`[Transcript] fetch started (videoId: ${videoId})`);
        const trackToLoad = tracks.find(t => t.baseUrl === selectedTrackUrl);
        if (!trackToLoad) return;
        
        let res: TranscriptResult;

        if (displayLanguage === 'both') {
          const tlangTr = trackToLoad.languageCode === 'tr' ? undefined : 'tr';
          const tlangEn = trackToLoad.languageCode === 'en' ? undefined : 'en';

          // Use independent abort controllers for each language fetch
          const abortTr = new AbortController();
          const abortEn = new AbortController();
          
          // Link parent abort to both children
          const parentSignal = abortControllerRef.current?.signal;
          if (parentSignal) {
            onParentAbort = () => { abortTr.abort(); abortEn.abort(); };
            parentSignal.addEventListener('abort', onParentAbort);
          }

          // Fetch primary language (Turkish)
          const resTr = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortTr, tlangTr);
          console.log(`[Transcript] primary received (dil: ${resTr.segments[0]?.languageCode}, segment: ${resTr.segments.length})`);

          
          // Fetch secondary language (English) — wrapped in try/catch
          let resEn: TranscriptResult | null = null;
          try {
            resEn = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortEn, tlangEn);
            if (resEn) console.log(`[Transcript] secondary received (dil: ${resEn.segments[0]?.languageCode}, segment: ${resEn.segments.length})`);
          } catch (enErr: any) {
            if (enErr.name === 'AbortError') throw enErr; // Re-throw abort
            console.warn('ZYouTube: İngilizce transkript alınamadı:', enErr.message);
            if (active) setDualLangWarning('İngilizce çeviri alınamadı. Yalnızca Türkçe gösteriliyor.');
          }
          
          // Fix 4: İki işaretçili sağlam eşleştirme
          const mergedSegments = resTr.segments.map((seg) => {
            return { ...seg, enParts: [] as string[] };
          });
          
          if (resEn && resEn.segments.length > 0) {
             for (const enSeg of resEn.segments) {
                const enEnd = enSeg.startTimeMs + enSeg.durationMs;
                let bestMatchIndex = -1;
                let maxOverlap = 0;
                let bestDiff = Infinity;
                
                // 1. En yüksek zaman örtüşmesini bul
                for (let i = 0; i < mergedSegments.length; i++) {
                   const seg = mergedSegments[i];
                   const segEnd = seg.startTimeMs + seg.durationMs;
                   
                   const overlapStart = Math.max(enSeg.startTimeMs, seg.startTimeMs);
                   const overlapEnd = Math.min(enEnd, segEnd);
                   const overlap = overlapEnd - overlapStart;
                   
                   if (overlap > 0 && overlap > maxOverlap) {
                      maxOverlap = overlap;
                      bestMatchIndex = i;
                   }
                }
                
                // 2. Örtüşme yoksa en yakın başlangıç zamanına (max 5sn) bak
                if (bestMatchIndex === -1) {
                   for (let i = 0; i < mergedSegments.length; i++) {
                      const diff = Math.abs(mergedSegments[i].startTimeMs - enSeg.startTimeMs);
                      if (diff < bestDiff && diff <= 5000) {
                         bestDiff = diff;
                         bestMatchIndex = i;
                      }
                   }
                }
                
                // İngilizce parçayı ata
                if (bestMatchIndex >= 0 && enSeg.cleanText) {
                   mergedSegments[bestMatchIndex].enParts.push(enSeg.cleanText);
                }
             }
             
             // Parçaları birleştir ve bitişik tekrarları sil
             for (const seg of mergedSegments) {
                if (seg.enParts.length > 0) {
                   const uniqueParts = seg.enParts.filter((part, idx, arr) => idx === 0 || part !== arr[idx - 1]);
                   (seg as any).secondaryText = uniqueParts.join(' ');
                }
                delete (seg as any).enParts;
             }
          }
          
          
          res = { ...resTr, segments: mergedSegments };
        } else {
          const tlang = trackToLoad.languageCode === displayLanguage ? undefined : displayLanguage;
          res = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortControllerRef.current || undefined, tlang);
        }

        if (active) {
            setResult(res);
            console.log(`[Transcript] result committed`);
            if (onTranscriptLoaded) onTranscriptLoaded(res);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error(`[Transcript] failed`, err);
        if (active) setError(err.message || 'Transkript alınırken bir hata oluştu.');
      } finally {
        if (active) setLoading(false);
        const parentSignal = abortControllerRef.current?.signal;
        if (parentSignal && onParentAbort) {
          parentSignal.removeEventListener('abort', onParentAbort);
        }
      }
    };

    fetchTranscripts();

    return () => { 
      active = false;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [selectedTrackUrl, videoId, tracks, displayLanguage, reloadCounter]);

  // 3. Track video time
  useEffect(() => {
    const video = document.querySelector('video');
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime * 1000);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [videoId]);

  // (Moved Auto-sync scroll below declarations)

  const seekTo = (ms: number) => {
    const videoElements = document.querySelectorAll('video');
    for (let i = 0; i < videoElements.length; i++) {
      const vid = videoElements[i];
      if (vid.baseURI.includes(videoId)) {
        vid.currentTime = ms / 1000;
        break;
      }
    }
  };

  // Search filtering for original segments
  const filteredSegments = useMemo(() => {
    if (!result) return [];
    if (!searchQuery.trim()) return result.segments;
    
    const query = searchQuery.toLowerCase().trim();
    return result.segments.filter(seg => {
      if (exactMatch) {
        return seg.cleanText.toLowerCase().includes(query) || (seg.secondaryText && seg.secondaryText.toLowerCase().includes(query));
      } else {
        const words = query.split(/\s+/);
        return words.every(w => seg.cleanText.toLowerCase().includes(w) || (seg.secondaryText && seg.secondaryText.toLowerCase().includes(w)));
      }
    });
  }, [result, searchQuery, exactMatch]);
  
  // Search filtering for corrected sentences
  const filteredSentences = useMemo(() => {
    if (!correctedSentences) return [];
    if (!searchQuery.trim()) return correctedSentences;
    
    const query = searchQuery.toLowerCase().trim();
    return correctedSentences.filter(seg => {
      if (exactMatch) {
        return (seg.correctedTurkish && seg.correctedTurkish.toLowerCase().includes(query)) || 
               (seg.correctedEnglish && seg.correctedEnglish.toLowerCase().includes(query)) ||
               (seg.originalTurkish && seg.originalTurkish.toLowerCase().includes(query)) ||
               (seg.originalEnglish && seg.originalEnglish.toLowerCase().includes(query));
      } else {
        const words = query.split(/\s+/);
        return words.every(w => 
          (seg.correctedTurkish && seg.correctedTurkish.toLowerCase().includes(w)) || 
          (seg.correctedEnglish && seg.correctedEnglish.toLowerCase().includes(w)) ||
          (seg.originalTurkish && seg.originalTurkish.toLowerCase().includes(w)) ||
          (seg.originalEnglish && seg.originalEnglish.toLowerCase().includes(w))
        );
      }
    });
  }, [correctedSentences, searchQuery, exactMatch]);

  const effectiveCorrectionMode = correctedSentences && correctedSentences.length > 0 ? correctionMode : 'original';

  const displayedItemsLength = effectiveCorrectionMode === 'original' ? filteredSegments.length : filteredSentences.length;

  // Find EXACT active segment to avoid double lines
  const activeSegmentId = useMemo(() => {
    if (searchQuery) return null; // don't highlight during search
    let activeId = null;
    
    if (effectiveCorrectionMode === 'original') {
      for (let i = 0; i < filteredSegments.length; i++) {
        if (filteredSegments[i].startTimeMs <= currentTime) {
          activeId = filteredSegments[i].id;
        } else {
          break;
        }
      }
    } else {
      for (let i = 0; i < filteredSentences.length; i++) {
        if (filteredSentences[i].startTimeMs <= currentTime) {
          activeId = filteredSentences[i].id;
        } else {
          break;
        }
      }
    }
    return activeId;
  }, [filteredSegments, filteredSentences, currentTime, searchQuery, correctionMode]);

  // Virtual/paginated rendering
  const [visibleCount, setVisibleCount] = useState(150);

  // 4. Auto-sync scroll
  useEffect(() => {
    let activeIndex = -1;
    if (effectiveCorrectionMode === 'original') {
      activeIndex = filteredSegments.findIndex(s => s.id === activeSegmentId);
    } else {
      activeIndex = filteredSentences.findIndex(s => s.id === activeSegmentId);
    }
    
    if (
      autoSync &&
      !searchQuery &&
      activeIndex >= visibleCount - 30
    ) {
      setVisibleCount(current =>
        Math.max(current, activeIndex + 30)
      );
      return;
    }
  }, [autoSync, searchQuery, activeSegmentId, filteredSegments, filteredSentences, visibleCount, correctionMode]);

  useEffect(() => {
    if (!autoSync || searchQuery || !result) return;
    
    if (activeSegmentRef.current && containerRef.current) {
       const container = containerRef.current;
       const activeEl = activeSegmentRef.current;
       const targetTop = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
       
       container.scrollTo({
         top: Math.max(0, targetTop),
         behavior: 'smooth'
       });
    }
  }, [currentTime, autoSync, searchQuery, result, activeSegmentId, visibleCount]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      setVisibleCount(prev => Math.min(prev + 50, displayedItemsLength));
    }
  };

  useEffect(() => {
    setVisibleCount(150);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [searchQuery, exactMatch, selectedTrackUrl, displayLanguage]);


  const executeCorrection = async (segments: any[], sourceLang: string) => {
    try {
      setIsCorrecting(true);
      setCorrectionError(null);
      setCorrectionSuccessMsg(null);
      setCorrectionProgress({ stage: 'preparing', message: 'Türkçe ve İngilizce transkript hazırlanıyor...', elapsedMs: 0 });
      
      const taskId = `correction_${Date.now()}`;
      activeCorrectionTaskIdRef.current = taskId;

      const title = document.querySelector('title')?.textContent?.replace('- YouTube', '').trim() || 'Video';
      
      const isTurkishSource = sourceLang.startsWith('tr');
      const mappedSegments = segments.map(s => {
        const trText = isTurkishSource ? s.cleanText : s.secondaryText || '';
        const enText = isTurkishSource ? s.secondaryText || '' : s.cleanText;
        return {
          id: s.id,
          startTimeMs: s.startTimeMs,
          endTimeMs: s.endTimeMs,
          turkish: trText,
          english: enText
        };
      });

      let emptyTurkishSegmentCount = 0;
      let emptyEnglishSegmentCount = 0;
      let turkishCharacterCount = 0;
      let englishCharacterCount = 0;

      for (const seg of mappedSegments) {
        if (!seg.turkish || seg.turkish.trim() === '') emptyTurkishSegmentCount++;
        else turkishCharacterCount += seg.turkish.length;

        if (!seg.english || seg.english.trim() === '') emptyEnglishSegmentCount++;
        else englishCharacterCount += seg.english.length;
      }

      const segmentCount = mappedSegments.length;
      const englishCoverageRatio = segmentCount > 0 ? ((segmentCount - emptyEnglishSegmentCount) / segmentCount) : 0;

      console.log('[ZYouTube Correction] Input coverage', {
        videoId,
        segmentCount,
        emptyTurkishSegmentCount,
        emptyEnglishSegmentCount,
        turkishCharacterCount,
        englishCharacterCount,
        englishCoverageRatio
      });

      if (englishCharacterCount === 0) {
        finishCorrectionWithError('İngilizce transkript içeriği bulunamadığı için düzeltme başlatılamadı.');
        return;
      }

      const request = {
        taskId,
        video: { videoId, title },
        transcript: {
          sourceLanguage: isTurkishSource ? 'tr' : 'en',
          segments: mappedSegments
        }
      };

      const res = await sendRuntimeMessage({
        type: 'START_CORRECTION',
        request
      });
      
      if (!res?.success) {
        throw new Error(res?.error || 'Düzeltme başlatılamadı.');
      }
    } catch (e: any) {
      finishCorrectionWithError(e.message || 'Düzeltme başlatılamadı.');
    }
  };

  const cancelCorrection = () => {
    if (!activeCorrectionTaskIdRef.current) return;
    
    setIsCancelling(true);
    chrome.runtime.sendMessage({
      type: 'CANCEL_CORRECTION',
      taskId: activeCorrectionTaskIdRef.current,
      videoId
    }).catch(console.error);
    
    finishCorrectionWithError('İstek kullanıcı tarafından iptal edildi.');
  };

  const startCorrection = async () => {
    if (correctedSentences) {
      if (!window.confirm('Zaten düzeltilmiş bir transkriptiniz var. Yeniden düzeltmek istediğinize emin misiniz?')) {
        return;
      }
    }
    
    const hasSecondaryAnywhere = result?.segments.some(s => s.secondaryText && s.secondaryText.trim() !== '');
    if (!hasSecondaryAnywhere) {
      setDisplayLanguage('both');
      setPendingCorrection(true);
      return;
    }
    
    if (result && result.segments.length > 0) {
      executeCorrection(result.segments, result.segments[0].languageCode);
    }
  };

  useEffect(() => {
     if (pendingCorrection && result && !loading) {
         const hasSecondaryAnywhere = result.segments.some(s => s.secondaryText && s.secondaryText.trim() !== '');
         if (hasSecondaryAnywhere && result.segments.length > 0) {
            setPendingCorrection(false);
            executeCorrection(result.segments, result.segments[0].languageCode);
         } else if (error || dualLangWarning) {
            finishCorrectionWithError('İkinci dil alınamadığı için API çağrısı iptal edildi.');
         }
     }
  }, [pendingCorrection, result, loading, error, dualLangWarning]);

  if (loading && !result) return <div className="p-4 text-sm animate-pulse">Transkript yükleniyor...</div>;
  if (error && !result) return (
    <div className="p-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded h-full flex flex-col items-center justify-center gap-3">
      <span>{error}</span>
      <button onClick={() => setReloadCounter(c => c + 1)} className="px-3 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 rounded hover:bg-red-200">Tekrar Dene</button>
    </div>
  );
  if (!result) return null;

  return (
    <div className="flex flex-col gap-2 text-sm h-full overflow-hidden">
      <div className="flex flex-col gap-2 bg-gray-200 dark:bg-gray-700 p-2 rounded shrink-0">
        <div className="flex justify-between items-center">
          <div className="flex gap-2 items-center">
            <select 
              className="text-xs p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-black dark:text-white"
              value={selectedTrackUrl}
              onChange={(e) => setSelectedTrackUrl(e.target.value)}
            >
              {tracks.map(t => (
                <option key={t.baseUrl} value={t.baseUrl}>
                  {t.name.simpleText} ({t.sourceType === 'automatic' ? 'Otomatik' : t.sourceType === 'manual' ? 'Manuel' : t.sourceType})
                </option>
              ))}
            </select>
            {correctedSentences && (
              <select
                className="text-xs p-1 rounded border border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
                value={correctionMode}
                onChange={e => setCorrectionMode(e.target.value as any)}
              >
                <option value="original">Orijinal</option>
                <option value="corrected">Düzeltilmiş</option>
                <option value="both">Orijinal + Düzeltilmiş</option>
              </select>
            )}
          </div>
          <div className="text-xs text-black dark:text-white flex gap-2 items-center">
            <button 
              onClick={startCorrection}
              disabled={isCorrecting || pendingCorrection}
              className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {correctedSentences ? '✨ Yeniden Düzelt' : '✨ Düzelt'}
            </button>
            <div className="flex items-center">
              <span className="font-semibold">Kalite: </span>
              <span className={result.quality?.level === 'high' ? 'text-green-600 dark:text-green-400 ml-1' : result.quality?.level === 'medium' ? 'text-yellow-600 dark:text-yellow-400 ml-1' : 'text-red-600 dark:text-red-400 ml-1'}>
                {result.quality?.level === 'high' ? 'Yüksek' : result.quality?.level === 'medium' ? 'Orta' : 'Düşük'}
              </span>
              <span className="ml-1 text-gray-500">({result.quality?.internalScore}/100)</span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 items-center">
          <input 
            type="text" 
            placeholder="Transkriptte ara..."
            className="flex-1 px-2 py-1 border rounded text-black dark:text-white dark:bg-gray-800 text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs whitespace-nowrap cursor-pointer text-black dark:text-white">
            <input 
              type="checkbox" 
              checked={exactMatch}
              onChange={(e) => setExactMatch(e.target.checked)}
            />
            Tam İfade
          </label>
        </div>

        {/* New Toolbar */}
        <div className="flex gap-2 items-center text-xs mt-1 border-t border-gray-300 dark:border-gray-600 pt-2 text-black dark:text-white">
          <button onClick={() => setFontSize(f => Math.max(10, f - 1))} className="px-2 py-1 bg-white dark:bg-gray-800 border rounded border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">A-</button>
          <button onClick={() => setFontSize(f => Math.min(24, f + 1))} className="px-2 py-1 bg-white dark:bg-gray-800 border rounded border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700">A+</button>
          
          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap ml-2">
            <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} />
            Oto-Kaydırma
          </label>

          <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap ml-2">
            <input type="checkbox" checked={showTimestamps} onChange={e => setShowTimestamps(e.target.checked)} />
            Zaman
          </label>
          
          <select 
            className="ml-auto p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-black dark:text-white"
            value={displayLanguage}
            onChange={e => setDisplayLanguage(e.target.value as any)}
          >
            <option value="tr">Türkçe</option>
            <option value="en">İngilizce</option>
            <option value="both">Türkçe + İngilizce</option>
          </select>
        </div>
      </div>
      
      {error && result && (
        <div className="text-red-600 dark:text-red-400 text-xs p-2 bg-red-50 dark:bg-red-900/20 rounded shrink-0 flex justify-between items-center">
          <span>⚠️ Yeni dil yüklenemedi. Önceki transkript gösteriliyor.</span>
          <button onClick={() => setReloadCounter(c => c + 1)} className="underline font-semibold ml-2 text-red-700 dark:text-red-300">Tekrar Dene</button>
        </div>
      )}
      
      {result.quality?.level !== 'high' && (result.quality?.reasons?.length || 0) > 0 && (
        <div className="text-yellow-600 dark:text-yellow-400 text-xs p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded shrink-0">
          ⚠️ {result.quality?.reasons.join(' ')}
        </div>
      )}

      {dualLangWarning && !error && (
        <div className="bg-yellow-100 dark:bg-yellow-900 border-l-4 border-yellow-500 text-yellow-700 dark:text-yellow-200 p-2 text-xs shrink-0 flex justify-between items-center">
          <span>{dualLangWarning}</span>
          <button onClick={() => setReloadCounter(c => c + 1)} className="ml-2 px-2 py-1 bg-yellow-200 dark:bg-yellow-800 rounded hover:bg-yellow-300 dark:hover:bg-yellow-700 font-semibold transition-colors">
            Tekrar Dene
          </button>
        </div>
      )}

      {(isCorrecting || pendingCorrection) && correctionProgress && (
        <div className="bg-blue-50 dark:bg-blue-900 border-l-4 border-blue-500 text-blue-800 dark:text-blue-200 p-3 text-sm shrink-0 shadow-sm rounded-r flex justify-between items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-blue-600 dark:text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="font-semibold text-blue-900 dark:text-blue-100">Transkript Düzeltiliyor...</span>
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-300 pl-6">
              {correctionProgress.message} {correctionProgress.elapsedMs > 0 && `(${Math.floor(correctionProgress.elapsedMs / 60000).toString().padStart(2, '0')}:${Math.floor((correctionProgress.elapsedMs % 60000) / 1000).toString().padStart(2, '0')})`}
            </div>
          </div>
          <button 
            onClick={cancelCorrection}
            disabled={!activeCorrectionTaskIdRef.current}
            className="px-3 py-1.5 bg-white dark:bg-blue-800 text-blue-600 dark:text-blue-200 rounded border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-700 font-semibold transition-colors shadow-sm text-xs disabled:opacity-50"
          >
            İptal
          </button>
        </div>
      )}
      
      {correctionSuccessMsg && !isCorrecting && !pendingCorrection && (
        <div className="bg-green-100 dark:bg-green-900 border-l-4 border-green-500 text-green-700 dark:text-green-200 p-2 text-xs shrink-0 flex justify-between items-center">
          <span>{correctionSuccessMsg}</span>
          <button onClick={() => setCorrectionSuccessMsg(null)} className="opacity-75 hover:opacity-100 font-bold ml-2">×</button>
        </div>
      )}

      {correctionError && (
        <div className="bg-red-100 dark:bg-red-900 border-l-4 border-red-500 text-red-700 dark:text-red-200 p-2 text-xs shrink-0 flex justify-between items-center">
          <span>{correctionError}</span>
          <button onClick={() => setCorrectionError(null)} className="opacity-75 hover:opacity-100 font-bold ml-2">×</button>
        </div>
      )}

      {searchQuery && (
        <div className="text-xs text-gray-500 px-1 shrink-0">
          {displayedItemsLength} sonuç bulundu.
        </div>
      )}

      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 flex flex-col gap-1 overflow-y-auto pr-2 relative text-black dark:text-gray-100"
      >
        {loading && <div className="absolute inset-0 bg-white/50 dark:bg-black/50 z-10 flex items-center justify-center">Yükleniyor...</div>}
        
        {correctionMode === 'original' ? (
          filteredSegments.slice(0, visibleCount).map(seg => {
            const minutes = Math.floor(seg.startTimeMs / 60000);
            const seconds = Math.floor((seg.startTimeMs % 60000) / 1000);
            const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            const isActive = activeSegmentId === seg.id;
            
            // Mükerrer metin temizleme
            let displayText = seg.cleanText;
            if (displayText.startsWith(timeString)) {
              displayText = displayText.substring(timeString.length).trim();
            }

            let displaySecondaryText = seg.secondaryText;
            if (displaySecondaryText && displaySecondaryText.startsWith(timeString)) {
               displaySecondaryText = displaySecondaryText.substring(timeString.length).trim();
            }
            
            const isTurkishSource = result?.segments[0]?.languageCode?.startsWith('tr');
            const trText = isTurkishSource ? displayText : displaySecondaryText;
            const enText = isTurkishSource ? displaySecondaryText : displayText;
            
            return (
              <div 
                key={seg.id} 
                ref={isActive ? activeSegmentRef : null}
                className={`flex gap-3 p-2 rounded group transition-colors ${isActive ? 'bg-blue-100 dark:bg-blue-900/50' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.4 }}
              >
                {showTimestamps && (
                  <button 
                    onClick={() => seekTo(seg.startTimeMs)}
                    className={`px-2 py-1 h-fit text-center rounded bg-gray-100 dark:bg-gray-800 hover:underline font-mono mt-0.5 ${isActive ? 'text-blue-700 dark:text-blue-200 font-bold' : 'text-blue-600 dark:text-blue-400'}`}
                    style={{ fontSize: `${Math.max(10, fontSize - 2)}px` }}
                    title="Videoda bu süreye git"
                  >
                    {timeString}
                  </button>
                )}
                <div className={`flex-1 ${isActive ? 'font-medium text-black dark:text-white' : ''}`}>
                  <HighlightedText 
                    text={displayText} 
                    highlight={searchQuery} 
                    exact={exactMatch} 
                    isEnglish={!isTurkishSource}
                    englishSentence={enText}
                    turkishSentence={trText}
                    timestampMs={seg.startTimeMs}
                    onWordClick={handleWordClick}
                  />
                  {displaySecondaryText && (
                    <div className={`mt-1 ${isActive ? 'text-yellow-600 dark:text-yellow-300' : 'text-yellow-600 dark:text-yellow-400'}`}>
                      <HighlightedText 
                        text={displaySecondaryText} 
                        highlight={searchQuery} 
                        exact={exactMatch} 
                        isEnglish={isTurkishSource}
                        englishSentence={enText}
                        turkishSentence={trText}
                        timestampMs={seg.startTimeMs}
                        onWordClick={handleWordClick}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          filteredSentences.slice(0, visibleCount).map(seg => {
            const minutes = Math.floor(seg.startTimeMs / 60000);
            const seconds = Math.floor((seg.startTimeMs % 60000) / 1000);
            const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            const isActive = activeSegmentId === seg.id;
            
            return (
              <div 
                key={seg.id} 
                ref={isActive ? activeSegmentRef : null}
                className={`flex gap-3 p-2 rounded group transition-colors ${isActive ? 'bg-blue-100 dark:bg-blue-900/50' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                style={{ fontSize: `${fontSize}px`, lineHeight: 1.4 }}
              >
                {showTimestamps && (
                  <button 
                    onClick={() => seekTo(seg.startTimeMs)}
                    className={`px-2 py-1 h-fit text-center rounded bg-gray-100 dark:bg-gray-800 hover:underline font-mono mt-0.5 ${isActive ? 'text-blue-700 dark:text-blue-200 font-bold' : 'text-blue-600 dark:text-blue-400'}`}
                    style={{ fontSize: `${Math.max(10, fontSize - 2)}px` }}
                    title="Videoda bu süreye git"
                  >
                    {timeString}
                  </button>
                )}
                <div className={`flex-1 ${isActive ? 'font-medium text-black dark:text-white' : ''}`}>
                  {correctionMode === 'both' && (
                    <div className="mb-2 pl-2 border-l-2 border-gray-300 dark:border-gray-500 opacity-70">
                      <div className="text-gray-600 dark:text-gray-400">
                        <HighlightedText text={seg.originalTurkish} highlight={searchQuery} exact={exactMatch} />
                      </div>
                      {seg.originalEnglish && (
                        <div className="text-yellow-600/70 dark:text-yellow-400/70 mt-1">
                          <HighlightedText 
                            text={seg.originalEnglish} 
                            highlight={searchQuery} 
                            exact={exactMatch} 
                            isEnglish={true}
                            englishSentence={seg.originalEnglish}
                            turkishSentence={seg.originalTurkish}
                            timestampMs={seg.startTimeMs}
                            onWordClick={handleWordClick}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className="text-blue-900 dark:text-blue-100 font-medium">
                    <HighlightedText text={seg.correctedTurkish} highlight={searchQuery} exact={exactMatch} />
                  </div>
                  {seg.correctedEnglish && (
                    <div className="text-amber-700 dark:text-amber-400 mt-1">
                      <HighlightedText 
                        text={seg.correctedEnglish} 
                        highlight={searchQuery} 
                        exact={exactMatch} 
                        isEnglish={true}
                        englishSentence={seg.correctedEnglish}
                        turkishSentence={seg.correctedTurkish}
                        timestampMs={seg.startTimeMs}
                        correctedSentenceId={seg.id}
                        onWordClick={handleWordClick}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        {visibleCount < displayedItemsLength && (
          <div className="text-center py-2 text-xs text-gray-500">
            Daha fazla yükleniyor...
          </div>
        )}
      </div>

      {activePopup && (
        <WordDictionaryPopup
          {...activePopup}
          videoId={videoId}
          videoTitle={document.querySelector('title')?.textContent?.replace('- YouTube', '').trim() || 'Video'}
          onClose={() => setActivePopup(null)}
        />
      )}
    </div>
  );
};
