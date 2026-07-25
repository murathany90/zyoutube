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
            <mark key={i} className="bg-yellow-200 text-black px-0.5 rounded">{part}</mark>
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

export const TranscriptTab = ({ videoId }: { videoId: string }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [tracks, setTracks] = useState<CaptionTrack[]>([]);
  const [selectedTrackUrl, setSelectedTrackUrl] = useState<string>('');
  
  const [result, setResult] = useState<TranscriptResult | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [exactMatch, setExactMatch] = useState(false);
  
  const providerRef = useRef(new YouTubeTranscriptProvider());
  const abortControllerRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Fetch available tracks on videoId change
  useEffect(() => {
    let active = true;
    
    const initTracks = async () => {
      setLoading(true);
      setError(null);
      setResult(null);
      setTracks([]);
      
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

  // 2. Fetch transcript when selectedTrackUrl changes
  useEffect(() => {
    if (!selectedTrackUrl) return;
    
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    let active = true;
    const fetchTranscripts = async () => {
      setLoading(true);
      setError(null);
      try {
        const trackToLoad = tracks.find(t => t.baseUrl === selectedTrackUrl);
        if (!trackToLoad) return;
        
        const res = await providerRef.current.fetchTranscript(videoId, trackToLoad, abortControllerRef.current || undefined);
        if (active) setResult(res);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        if (active) setError(err.message || 'Transkript alınırken bir hata oluştu.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchTranscripts();

    return () => { 
      active = false; 
    };
  }, [selectedTrackUrl, videoId, tracks]);

  const seekTo = (ms: number) => {
    const videoElements = document.querySelectorAll('video');
    // Find the correct video element for youtube
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
        return seg.cleanText.toLowerCase().includes(query);
      } else {
        const words = query.split(/\s+/);
        return words.every(w => seg.cleanText.toLowerCase().includes(w));
      }
    });
  }, [result, searchQuery, exactMatch]);
  
  // Virtual/paginated rendering (Show first 150, load more on scroll)
  const [visibleCount, setVisibleCount] = useState(150);
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 100) {
      setVisibleCount(prev => Math.min(prev + 50, filteredSegments.length));
    }
  };

  // Reset pagination on search change
  useEffect(() => {
    setVisibleCount(150);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [searchQuery, exactMatch, selectedTrackUrl]);

  if (loading && !result) return <div className="p-4 text-sm animate-pulse">Transkript yükleniyor...</div>;
  if (error) return <div className="p-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>;
  if (!result) return null;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-2 bg-gray-200 dark:bg-gray-700 p-2 rounded">
        <div className="flex justify-between items-center">
          <select 
            className="text-xs p-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            value={selectedTrackUrl}
            onChange={(e) => setSelectedTrackUrl(e.target.value)}
          >
            {tracks.map(t => (
              <option key={t.baseUrl} value={t.baseUrl}>
                {t.name.simpleText} ({t.sourceType === 'automatic' ? 'Otomatik' : t.sourceType === 'manual' ? 'Manuel' : t.sourceType})
              </option>
            ))}
          </select>
          <div className="text-xs">
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
            className="flex-1 px-2 py-1 border rounded text-black text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs whitespace-nowrap cursor-pointer">
            <input 
              type="checkbox" 
              checked={exactMatch}
              onChange={(e) => setExactMatch(e.target.checked)}
            />
            Tam İfade
          </label>
        </div>
      </div>
      
      {result.quality?.level !== 'high' && (result.quality?.reasons?.length || 0) > 0 && (
        <div className="text-yellow-600 dark:text-yellow-400 text-xs p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
          ⚠️ {result.quality?.reasons.join(' ')}
        </div>
      )}

      {searchQuery && (
        <div className="text-xs text-gray-500 px-1">
          {filteredSegments.length} sonuç bulundu.
        </div>
      )}

      <div 
        ref={containerRef}
        onScroll={handleScroll}
        className="flex flex-col gap-1 mt-1 max-h-96 overflow-y-auto pr-2 relative"
      >
        {loading && <div className="absolute inset-0 bg-white/50 dark:bg-black/50 z-10 flex items-center justify-center">Yükleniyor...</div>}
        
        {filteredSegments.slice(0, visibleCount).map(seg => {
          const minutes = Math.floor(seg.startTimeMs / 60000);
          const seconds = Math.floor((seg.startTimeMs % 60000) / 1000);
          const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          
          return (
            <div key={seg.id} className="flex gap-2 hover:bg-gray-200 dark:hover:bg-gray-700 p-1.5 rounded group transition-colors">
              <button 
                onClick={() => seekTo(seg.startTimeMs)}
                className="text-blue-600 dark:text-blue-400 min-w-[40px] text-left hover:underline font-mono text-xs mt-0.5"
                title="Videoda bu süreye git"
              >
                {timeString}
              </button>
              <div className="flex-1">
                <HighlightedText text={seg.cleanText} highlight={searchQuery} exact={exactMatch} />
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
