import { useState, useEffect, useRef, useMemo } from 'react';
import { YouTubeTranscriptProvider, TranscriptResult, CaptionTrack } from '../transcript';

const HighlightedText = ({ text, highlight, exact }: { text: string, highlight: string, exact: boolean }) => {
  if (!highlight.trim()) return <span>{text}</span>;
  
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
            <mark key={i} className="bg-yellow-300 text-black px-0.5 rounded font-semibold">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          );
        })}
      </span>
    );
  } catch (e) {
    return <span>{text}</span>;
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
  
  const providerRef = useRef(new YouTubeTranscriptProvider());
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // 1. Fetch available tracks on videoId change
  useEffect(() => {
    let active = true;
    
    const initTracks = async () => {
      setLoading(true);
      setError(null);
      setResult(null); // Clear result on video change
      if (onTranscriptLoaded) onTranscriptLoaded(null);
      setTracks([]);
      setSelectedTrackUrl(''); // Yeni video için url'yi sıfırla
      
      try {
        const availableTracks = await providerRef.current.getAvailableTracks(videoId);
        if (active) {
          if (availableTracks.length === 0) {
            setError('Bu videoda erişilebilir manuel veya otomatik altyazı bulunamadı.');
          } else {
            setTracks(availableTracks);
            setSelectedTrackUrl(availableTracks[0].baseUrl);
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Kanallar yüklenirken hata oluştu.');
      } finally {
        if (active) setLoading(false);
      }
    };

    initTracks();
    
    return () => { active = false; };
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
          
          // Fetch secondary language (English) — wrapped in try/catch
          let resEn: TranscriptResult | null = null;
          try {
            resEn = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortEn, tlangEn);
          } catch (enErr: any) {
            if (enErr.name === 'AbortError') throw enErr; // Re-throw abort
            console.warn('ZYouTube: İngilizce transkript alınamadı:', enErr.message);
            if (active) setDualLangWarning('İngilizce çeviri alınamadı. Yalnızca Türkçe gösteriliyor.');
          }
          
          
          // Fix 4: İki işaretçili eşleştirme
          const mergedSegments = resTr.segments.map((seg) => {
            return { ...seg };
          });
          
          if (resEn && resEn.segments.length > 0) {
             let secIndex = 0;
             for (let i = 0; i < mergedSegments.length; i++) {
                const seg = mergedSegments[i];
                let bestMatchIndex = -1;
                let bestDiff = Infinity;
                
                // Önceki, mevcut ve sonraki en fazla üç adayı değerlendir
                for (let k = 0; k < 3; k++) {
                   const currIndex = secIndex + k;
                   if (currIndex >= resEn.segments.length) break;
                   const enSeg = resEn.segments[currIndex];
                   
                   const segEnd = seg.startTimeMs + seg.durationMs;
                   const enEnd = enSeg.startTimeMs + enSeg.durationMs;
                   const isOverlap = (enSeg.startTimeMs < segEnd) && (enEnd > seg.startTimeMs);
                   
                   if (isOverlap) {
                      bestMatchIndex = currIndex;
                      break; // Önce zaman aralığı örtüşmesini kabul et
                   }
                   
                   const diff = Math.abs(seg.startTimeMs - enSeg.startTimeMs);
                   if (diff < bestDiff && diff <= 5000) { // 5 saniyeden büyük farkı kabul etme
                      bestDiff = diff;
                      bestMatchIndex = currIndex;
                   }
                }
                
                if (bestMatchIndex >= 0) {
                   seg.secondaryText = resEn.segments[bestMatchIndex].cleanText;
                   secIndex = bestMatchIndex + 1;
                }
             }
          }
          
          
          res = { ...resTr, segments: mergedSegments };
        } else {
          const tlang = trackToLoad.languageCode === displayLanguage ? undefined : displayLanguage;
          res = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortControllerRef.current || undefined, tlang);
        }

        if (active) {
            setResult(res);
            if (onTranscriptLoaded) onTranscriptLoaded(res);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
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

  // Search filtering
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
  
  // Find EXACT active segment to avoid double lines
  const activeSegmentId = useMemo(() => {
    if (searchQuery) return null; // don't highlight during search
    let activeId = null;
    for (let i = 0; i < filteredSegments.length; i++) {
      if (filteredSegments[i].startTimeMs <= currentTime) {
        activeId = filteredSegments[i].id;
      } else {
        break;
      }
    }
    return activeId;
  }, [filteredSegments, currentTime, searchQuery]);

  // Virtual/paginated rendering
  const [visibleCount, setVisibleCount] = useState(150);

  // 4. Auto-sync scroll
  useEffect(() => {
    const activeIndex = filteredSegments.findIndex(s => s.id === activeSegmentId);
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
  }, [autoSync, searchQuery, activeSegmentId, filteredSegments, visibleCount]);

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
  }, [currentTime, autoSync, searchQuery, result, activeSegmentId]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      setVisibleCount(prev => Math.min(prev + 50, filteredSegments.length));
    }
  };

  useEffect(() => {
    setVisibleCount(150);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [searchQuery, exactMatch, selectedTrackUrl, displayLanguage]);

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
          <div className="text-xs text-black dark:text-white">
            <span className="font-semibold">Kalite: </span>
            <span className={result.quality?.level === 'high' ? 'text-green-600 dark:text-green-400' : result.quality?.level === 'medium' ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}>
              {result.quality?.level === 'high' ? 'Yüksek' : result.quality?.level === 'medium' ? 'Orta' : 'Düşük'}
            </span>
            <span className="ml-1 text-gray-500">({result.quality?.internalScore}/100)</span>
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

      {dualLangWarning && (
        <div className="text-amber-600 dark:text-amber-400 text-xs p-2 bg-amber-50 dark:bg-amber-900/20 rounded shrink-0">
          ⚠️ {dualLangWarning}
        </div>
      )}

      {searchQuery && (
        <div className="text-xs text-gray-500 px-1 shrink-0">
          {filteredSegments.length} sonuç bulundu.
        </div>
      )}

      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 flex flex-col gap-1 overflow-y-auto pr-2 relative text-black dark:text-gray-100"
      >
        {loading && <div className="absolute inset-0 bg-white/50 dark:bg-black/50 z-10 flex items-center justify-center">Yükleniyor...</div>}
        
        {filteredSegments.slice(0, visibleCount).map(seg => {
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
                <HighlightedText text={displayText} highlight={searchQuery} exact={exactMatch} />
                {displaySecondaryText && (
                  <div className={`mt-1 ${isActive ? 'text-yellow-600 dark:text-yellow-300' : 'text-yellow-600 dark:text-yellow-400'}`}>
                    <HighlightedText text={displaySecondaryText} highlight={searchQuery} exact={exactMatch} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visibleCount < filteredSegments.length && (
          <div className="text-center py-2 text-xs text-gray-500">
            Daha fazla yükleniyor...
          </div>
        )}
      </div>
    </div>
  );
};
