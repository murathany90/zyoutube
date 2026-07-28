import React, { useState, useEffect, useRef } from 'react';
import { LibraryService, VideoLibraryEntry } from './library-service';
import { HistoryService } from '../settings/history';
import { formatTime } from '../utils/formatters';
import { DictionaryDB } from '../dictionary/dictionary-db';
import { WordDictionaryPopup } from '../content/components/WordDictionaryPopup';
import { highlightSearchText, searchInTranscripts } from './history-helpers';
import './history.css';

export const HistoryPage = () => {
  const [entry, setEntry] = useState<VideoLibraryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'corrected' | 'words'>('summary');
  
  // Summary Language Tabs
  const [summaryLanguageMode, setSummaryLanguageMode] = useState<'tr' | 'en' | 'side-by-side'>('tr');
  
  // Dictionary Popup State
  const [selectedWordObj, setSelectedWordObj] = useState<{word: string, englishSentence: string, turkishSentence: string, timestampMs: number, correctedSentenceId?: string} | null>(null);
  const [popupPosition, setPopupPosition] = useState<{top: number, left: number} | null>(null);

  const [wordSearchQuery, setWordSearchQuery] = useState('');

  // Transcript Search State
  const [transcriptSearchQuery, setTranscriptSearchQuery] = useState('');
  const [transcriptLanguageFilter, setTranscriptLanguageFilter] = useState<'all' | 'tr' | 'en'>('all');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(-1);
  const resultRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (['summary', 'transcript', 'corrected', 'words'].includes(hash)) {
      setActiveTab(hash as any);
    }
  }, []);

  const handleTabChange = (tab: 'summary' | 'transcript' | 'corrected' | 'words') => {
    setActiveTab(tab);
    window.location.hash = tab;
    
    // Reset search when switching tabs
    setTranscriptSearchQuery('');
    setSearchResults([]);
    setActiveSearchResultIndex(-1);
  };

  const loadData = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      let videoIdParam = urlParams.get('videoId');
      const legacySummaryId = urlParams.get('id');
      
      if (!videoIdParam && legacySummaryId) {
        try {
          const legacySummary = await HistoryService.getSummary(legacySummaryId);
          if (legacySummary && legacySummary.videoId) {
            videoIdParam = legacySummary.videoId;
            // Update URL cleanly
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('id');
            newUrl.searchParams.set('videoId', videoIdParam);
            window.history.replaceState({}, '', newUrl.toString());
          }
        } catch (err) {
          console.error('[ZYouTube History] Legacy summary resolution failed', err);
        }
      }

      if (!videoIdParam) {
        setError('Geçersiz bağlantı (Video ID eksik).');
        setLoading(false);
        return;
      }

      const foundEntry = await LibraryService.getEntry(videoIdParam);
      
      if (foundEntry) {
        setEntry(foundEntry);
        
        const hasTr = !!foundEntry.savedSummary?.summary?.summary?.tr;
        const hasEn = !!foundEntry.savedSummary?.summary?.summary?.en;
        if (hasTr) {
          setSummaryLanguageMode('tr');
        } else if (hasEn) {
          setSummaryLanguageMode('en');
        }
        
        // Auto-select tab if summary doesn't exist
        if (!foundEntry.hasSummary && !window.location.hash) {
          if (foundEntry.hasCorrectedTranscript) setActiveTab('corrected');
          else if (foundEntry.hasOriginalTranscript) setActiveTab('transcript');
          else if (foundEntry.hasStudyWords) setActiveTab('words');
        }
      } else {
        setError('Kayıt bulunamadı.');
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Bilinmeyen hata');
      } else {
        setError('Bilinmeyen hata');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleMessage = (msg: unknown) => {
      const message = msg as any;
      if (message && message.type === 'LIBRARY_ENTRY_UPDATED' && entry && message.videoId === entry.videoId) {
        loadData();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [entry]);

  // Execute Search Effect
  useEffect(() => {
    if (!entry || !transcriptSearchQuery) {
      setSearchResults([]);
      setActiveSearchResultIndex(-1);
      return;
    }
    
    try {
      const query = transcriptSearchQuery;
      let matchedIndices: number[] = [];
      const fieldsToSearch: string[] = [];

      if (activeTab === 'corrected' && entry.correctedTranscript?.sentences) {
        if (transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'tr') fieldsToSearch.push('correctedTurkish');
        if (transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'en') fieldsToSearch.push('correctedEnglish');
        matchedIndices = searchInTranscripts(entry.correctedTranscript.sentences, query, fieldsToSearch).map(m => m.index);
      } else if (activeTab === 'transcript') {
        const sourceData = getOriginalTranscriptData();
        if (transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'tr') fieldsToSearch.push('text', 'originalTurkish');
        if (transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'en') fieldsToSearch.push('secondaryText', 'originalEnglish');
        matchedIndices = searchInTranscripts(sourceData, query, fieldsToSearch).map(m => m.index);
      }
      
      setSearchResults(matchedIndices);
      if (matchedIndices.length > 0) {
        setActiveSearchResultIndex(0);
      } else {
        setActiveSearchResultIndex(-1);
      }
    } catch (err) {
      console.error('[ZYouTube History] Transcript search failed', err);
      setSearchResults([]);
      setActiveSearchResultIndex(-1);
    }
  }, [transcriptSearchQuery, transcriptLanguageFilter, activeTab, entry]);

  // Scroll into view Effect
  useEffect(() => {
    if (searchResults.length > 0 && activeSearchResultIndex >= 0) {
      const activeIdx = searchResults[activeSearchResultIndex];
      const el = resultRefs.current[activeIdx];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeSearchResultIndex, searchResults]);

  const handleNextSearch = () => {
    if (searchResults.length === 0) return;
    setActiveSearchResultIndex((prev) => (prev + 1) % searchResults.length);
  };

  const handlePrevSearch = () => {
    if (searchResults.length === 0) return;
    setActiveSearchResultIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
  };

  const handleTimeClick = (ms: number | undefined | null) => {
    if (ms == null || !entry) return;
    const seconds = Math.floor(ms / 1000);
    const url = new URL(`https://www.youtube.com/watch?v=${entry.videoId}`);
    url.searchParams.set('t', `${seconds}s`);
    window.open(url.toString(), '_blank');
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, text: string, enSentence: string, trSentence: string, timestampMs: number, sentenceId?: string) => {
    e.stopPropagation();
    
    const x = e.clientX;
    const y = e.clientY + 15;
    
    setSelectedWordObj({
      word: text.trim(),
      englishSentence: enSentence,
      turkishSentence: trSentence,
      timestampMs,
      correctedSentenceId: sentenceId
    });
    setPopupPosition({ top: y, left: x });
  };

  const renderClickableWords = (content: string, enSentence: string, trSentence: string, timestampMs: number, sentenceId?: string) => {
    if (!content) return null;
    const wordParts = content.split(/([a-zA-Z]+(?:['’'-][a-zA-Z]+)*)/);
    return wordParts.map((wp, j) => {
      if (/^[a-zA-Z]+(?:['’'-][a-zA-Z]+)*$/.test(wp)) {
        return (
          <span 
            key={j} 
            className="zy-clickable-word"
            onClick={(e) => handleWordClick(e, wp, enSentence, trSentence, timestampMs, sentenceId)}
          >
            {highlightSearchText(wp, transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'en' ? transcriptSearchQuery : '')}
          </span>
        );
      }
      return <span key={j}>{highlightSearchText(wp, transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'en' ? transcriptSearchQuery : '')}</span>;
    });
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (confirm('Bu kaydı tamamen silmek istediğinize emin misiniz?')) {
      await LibraryService.deleteVideoEntry(entry.videoId);
      window.close();
    }
  };

  const handleExport = (type: 'md' | 'json', specificPart?: 'summary' | 'keyIdeas') => {
    if (!entry) return;
    
    let contentStr = '';
    let mimeType = 'text/plain';
    let ext = type;
    let fileNameSuffix = specificPart ? `_${specificPart}` : '';

    if (type === 'json') {
      contentStr = JSON.stringify(entry, null, 2);
      mimeType = 'application/json';
    } else if (type === 'md') {
      mimeType = 'text/markdown';
      contentStr = `# ${entry.title}\\n\\n`;
      
      if (entry.hasSummary && entry.savedSummary?.summary && (!specificPart || specificPart === 'summary')) {
        contentStr += `## Özet\\n`;
        if (entry.savedSummary.summary.summary?.tr) {
           contentStr += entry.savedSummary.summary.summary.tr + '\\n\\n';
        }
        if (entry.savedSummary.summary.summary?.en) {
           contentStr += `*${entry.savedSummary.summary.summary.en}*\\n\\n`;
        }
      }
      
      if (entry.hasSummary && entry.savedSummary?.summary?.keyIdeas && (!specificPart || specificPart === 'keyIdeas')) {
         contentStr += `### Önemli Noktalar\\n`;
         entry.savedSummary.summary.keyIdeas.forEach((k: any) => {
           contentStr += `- **${k.title?.tr || k.title?.en}**: ${k.description?.tr || k.description?.en}\\n`;
         });
         contentStr += '\\n';
      }
      
      if (!specificPart && entry.hasCorrectedTranscript && entry.correctedTranscript?.sentences) {
        contentStr += `## Transkript (Düzeltilmiş)\\n\\n`;
        entry.correctedTranscript.sentences.forEach((s: any) => {
          contentStr += `- [${formatTime(s.startTimeMs || 0)}] **${s.correctedTurkish}**\\n  *${s.correctedEnglish}*\\n\\n`;
        });
      }
      
      if (!specificPart && entry.hasStudyWords && entry.studyWords) {
        contentStr += `## Çalışılacak Kelimeler\\n\\n`;
        entry.studyWords.forEach((w: any) => {
           contentStr += `- **${w.displayWord}** (${w.meaningsTr.join(', ')})\\n`;
        });
      }
    }
    
    const blob = new Blob([contentStr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}${fileNameSuffix}_${type}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // simple toast could be added here
    });
  };

  const getOriginalTranscriptData = () => {
    if (entry?.savedSummary?.transcript && entry.savedSummary.transcript.length > 0) {
      return entry.savedSummary.transcript;
    }
    
    if (entry?.correctedTranscript?.sentences) {
      return entry.correctedTranscript.sentences
        .filter((s: any) => s.originalTurkish || s.originalEnglish)
        .map((s: any) => ({
          id: s.id,
          startTimeMs: s.startTimeMs,
          text: s.originalTurkish,
          secondaryText: s.originalEnglish
        }));
    }
    
    return [];
  };

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Yükleniyor...</div>;
  }

  if (error || !entry) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  }

  const { savedSummary, correctedTranscript, studyWords } = entry;
  const filteredStudyWords = (studyWords || []).filter(w => {
    if (wordSearchQuery && !w.displayWord.toLowerCase().includes(wordSearchQuery.toLowerCase()) && !w.meaningsTr.some(m => m.toLowerCase().includes(wordSearchQuery.toLowerCase()))) return false;
    return true;
  });

  const hasTr = !!savedSummary?.summary?.summary?.tr;
  const hasEn = !!savedSummary?.summary?.summary?.en;

  const originalTranscriptData = getOriginalTranscriptData();

  return (
    <div className="zy-history-container">
      <div className="zy-history-header">
        <h1 className="zy-history-title">
          <img src={`https://i.ytimg.com/vi/${entry.videoId}/mqdefault.jpg`} 
               style={{ width: '64px', height: '36px', objectFit: 'cover', borderRadius: '4px' }} 
               onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          {entry.title}
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="zy-btn" onClick={() => handleExport('md')}>MD İndir</button>
          <button className="zy-btn" onClick={() => handleExport('json')}>JSON İndir</button>
          <button className="zy-btn zy-btn-danger" onClick={handleDelete}>Sil</button>
        </div>
      </div>

      <div className="zy-history-tabs">
        <button className={`zy-history-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => handleTabChange('summary')} disabled={!entry.hasSummary}>
          Özet Detayı
        </button>
        {entry.hasCorrectedTranscript && (
          <button className={`zy-history-tab ${activeTab === 'corrected' ? 'active' : ''}`} onClick={() => handleTabChange('corrected')}>
            Düzeltilmiş Transkript
          </button>
        )}
        {entry.hasOriginalTranscript && (
          <button className={`zy-history-tab ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => handleTabChange('transcript')}>
            Orijinal Transkript
          </button>
        )}
        {entry.hasStudyWords && (
          <button className={`zy-history-tab ${activeTab === 'words' ? 'active' : ''}`} onClick={() => handleTabChange('words')}>
            Çalışılacak Kelimeler ({entry.studyWordCount})
          </button>
        )}
      </div>

      <div className="zy-history-content">
        <div className="zy-history-scroll-area">
          {activeTab === 'summary' && !entry.hasSummary && (
             <div style={{ color: '#6b7280', fontSize: '14px', textAlign: 'center', padding: '40px' }}>
               Bu video için özet oluşturulmamış.
             </div>
          )}
          {activeTab === 'summary' && savedSummary && savedSummary.summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                 {hasTr && <button className={`zy-btn ${summaryLanguageMode === 'tr' ? 'active' : ''}`} style={{ background: summaryLanguageMode === 'tr' ? '#dbeafe' : '', color: summaryLanguageMode === 'tr' ? '#1e40af' : '' }} onClick={() => setSummaryLanguageMode('tr')}>Türkçe</button>}
                 {hasEn && <button className={`zy-btn ${summaryLanguageMode === 'en' ? 'active' : ''}`} style={{ background: summaryLanguageMode === 'en' ? '#dbeafe' : '', color: summaryLanguageMode === 'en' ? '#1e40af' : '' }} onClick={() => setSummaryLanguageMode('en')}>İngilizce</button>}
                 {hasTr && hasEn && <button className={`zy-btn ${summaryLanguageMode === 'side-by-side' ? 'active' : ''}`} style={{ background: summaryLanguageMode === 'side-by-side' ? '#dbeafe' : '', color: summaryLanguageMode === 'side-by-side' ? '#1e40af' : '' }} onClick={() => setSummaryLanguageMode('side-by-side')}>Yan Yana</button>}
              </div>
              
              <div className="zy-summary-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 className="zy-summary-section-title" style={{ margin: 0 }}>Genel Özet</h2>
                  <div style={{ display: 'flex', gap: '6px' }}>
                     <button className="zy-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => {
                        let t = '';
                        if (summaryLanguageMode === 'tr' || summaryLanguageMode === 'side-by-side') t += savedSummary.summary?.summary?.tr + '\\n';
                        if (summaryLanguageMode === 'en' || summaryLanguageMode === 'side-by-side') t += savedSummary.summary?.summary?.en;
                        handleCopy(t);
                     }}>Kopyala</button>
                     <button className="zy-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleExport('md', 'summary')}>İndir</button>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '20px', flexDirection: summaryLanguageMode === 'side-by-side' ? 'row' : 'column' }}>
                  {(summaryLanguageMode === 'tr' || summaryLanguageMode === 'side-by-side') && savedSummary.summary?.summary?.tr && (
                    <div className="zy-summary-text" style={{ flex: 1 }}>{savedSummary.summary.summary.tr}</div>
                  )}
                  {(summaryLanguageMode === 'en' || summaryLanguageMode === 'side-by-side') && savedSummary.summary?.summary?.en && (
                    <div className="zy-summary-text" style={{ flex: 1, fontStyle: summaryLanguageMode === 'side-by-side' ? 'normal' : 'italic', color: summaryLanguageMode === 'side-by-side' ? '#1f2937' : '#6b7280' }}>
                      {savedSummary.summary.summary.en}
                    </div>
                  )}
                </div>
              </div>

              {savedSummary.summary.keyIdeas && savedSummary.summary.keyIdeas.length > 0 && (
                <div className="zy-summary-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 className="zy-summary-section-title" style={{ margin: 0 }}>Ana Fikirler</h2>
                    <div style={{ display: 'flex', gap: '6px' }}>
                       <button className="zy-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => {
                          let t = '';
                          savedSummary.summary?.keyIdeas?.forEach(k => {
                            if (summaryLanguageMode === 'tr' || summaryLanguageMode === 'side-by-side') t += `- ${k.title?.tr}: ${k.description?.tr}\\n`;
                            else if (summaryLanguageMode === 'en') t += `- ${k.title?.en}: ${k.description?.en}\\n`;
                          });
                          handleCopy(t);
                       }}>Kopyala</button>
                       <button className="zy-btn" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => handleExport('md', 'keyIdeas')}>İndir</button>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {savedSummary.summary.keyIdeas.map((idea, i) => (
                      <div key={i} style={{ display: 'flex', gap: '20px', flexDirection: summaryLanguageMode === 'side-by-side' ? 'row' : 'column' }}>
                        {(summaryLanguageMode === 'tr' || summaryLanguageMode === 'side-by-side') && (
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0', color: '#1f2937' }}>
                              {idea.title?.tr}
                            </h3>
                            <p style={{ fontSize: '14px', color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
                              {idea.description?.tr}
                            </p>
                          </div>
                        )}
                        {(summaryLanguageMode === 'en' || summaryLanguageMode === 'side-by-side') && (
                          <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0', color: '#1f2937' }}>
                              {idea.title?.en}
                            </h3>
                            <p style={{ fontSize: '14px', color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
                              {idea.description?.en}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {(activeTab === 'corrected' || activeTab === 'transcript') && (
            <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', background: '#f8fafc', padding: '10px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <input 
                type="text" 
                placeholder="Transkript içinde ara..." 
                value={transcriptSearchQuery}
                onChange={e => setTranscriptSearchQuery(e.target.value)}
                style={{ width: '250px', padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
              />
              <select 
                value={transcriptLanguageFilter}
                onChange={e => setTranscriptLanguageFilter(e.target.value as any)}
                style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '13px' }}
              >
                <option value="all">Tümü (Dil)</option>
                <option value="tr">Türkçe</option>
                <option value="en">İngilizce</option>
              </select>
              
              {transcriptSearchQuery && searchResults.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                  <span style={{ fontSize: '12px', color: '#4b5563' }}>{activeSearchResultIndex + 1} / {searchResults.length}</span>
                  <button onClick={handlePrevSearch} style={{ padding: '4px 8px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '4px', cursor: 'pointer' }}>↑</button>
                  <button onClick={handleNextSearch} style={{ padding: '4px 8px', border: '1px solid #d1d5db', background: '#fff', borderRadius: '4px', cursor: 'pointer' }}>↓</button>
                </div>
              )}
              {transcriptSearchQuery && searchResults.length === 0 && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginLeft: 'auto' }}>Sonuç bulunamadı</div>
              )}
              <button 
                onClick={() => setTranscriptSearchQuery('')}
                style={{ padding: '6px 10px', borderRadius: '4px', border: 'none', background: 'transparent', color: '#6b7280', fontSize: '13px', cursor: 'pointer' }}
              >
                Temizle
              </button>
            </div>
          )}

          {activeTab === 'corrected' && correctedTranscript && (
            <div className="zy-summary-card" style={{ padding: 0 }}>
              {correctedTranscript.sentences.map((sentence: any, i: number) => {
                const isActiveMatch = searchResults[activeSearchResultIndex] === i;
                return (
                  <div key={i} 
                       className={`zy-sentence-row ${isActiveMatch ? 'zy-sentence-row-active' : ''}`}
                       ref={el => resultRefs.current[i] = el}>
                    <div className="zy-sentence-time" onClick={() => handleTimeClick(sentence.startTimeMs)}>
                      {formatTime(sentence.startTimeMs || 0)}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                      <div className="zy-sentence-tr">
                        {highlightSearchText(sentence.correctedTurkish || '', transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'tr' ? transcriptSearchQuery : '')}
                      </div>
                      <div className="zy-sentence-en">
                        {renderClickableWords(sentence.correctedEnglish || '', sentence.correctedEnglish || '', sentence.correctedTurkish || '', sentence.startTimeMs || 0, sentence.id)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'transcript' && originalTranscriptData && (
            <div className="zy-summary-card" style={{ padding: 0 }}>
               {originalTranscriptData.map((item: any, i: number) => {
                 const isActiveMatch = searchResults[activeSearchResultIndex] === i;
                 return (
                   <div key={i} 
                        className={`zy-sentence-row ${isActiveMatch ? 'zy-sentence-row-active' : ''}`}
                        ref={el => resultRefs.current[i] = el}>
                     <div className="zy-sentence-time" onClick={() => handleTimeClick(item.startTimeMs)}>
                       {formatTime(item.startTimeMs || 0)}
                     </div>
                     <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                       <div className="zy-sentence-tr">
                         {highlightSearchText(item.text || '', transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'tr' ? transcriptSearchQuery : '')}
                       </div>
                       {item.secondaryText && (
                         <div className="zy-sentence-en" style={{ fontStyle: 'italic', color: '#6b7280' }}>
                           {highlightSearchText(item.secondaryText, transcriptLanguageFilter === 'all' || transcriptLanguageFilter === 'en' ? transcriptSearchQuery : '')}
                         </div>
                       )}
                     </div>
                   </div>
                 );
               })}
            </div>
          )}

          {activeTab === 'words' && entry.studyWords && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <input 
                  type="text" 
                  placeholder="Kelime ara..." 
                  value={wordSearchQuery}
                  onChange={e => setWordSearchQuery(e.target.value)}
                  style={{ width: '100%', maxWidth: '300px', padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db' }}
                />
              </div>
              <div className="zy-word-grid">
                {filteredStudyWords.map(word => (
                  <div key={word.id} className="zy-word-card">
                    <div className="zy-word-header">
                      <h3 className="zy-word-title">
                        {word.displayWord}
                        {word.partOfSpeech && <span className="zy-word-pos">{word.partOfSpeech}</span>}
                      </h3>
                      <button 
                        onClick={() => {
                          if (confirm('Kelimeyi listeden çıkarmak istediğinize emin misiniz?')) {
                             DictionaryDB.removeStudyWord(word.id).then(() => {
                               setEntry(prev => {
                                 if (!prev) return prev;
                                 const remaining = prev.studyWords?.filter(w => w.id !== word.id) || [];
                                 return {
                                   ...prev,
                                   studyWords: remaining,
                                   studyWordCount: remaining.length,
                                   hasStudyWords: remaining.length > 0
                                 };
                               });
                               chrome.runtime.sendMessage({ type: 'LIBRARY_ENTRY_UPDATED', videoId: entry.videoId, reason: 'word_removed' }).catch(() => undefined);
                             });
                          }
                        }}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
                        title="Çıkar"
                      >
                         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                           <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                         </svg>
                      </button>
                    </div>
                    {word.phonetic && <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>{word.phonetic}</div>}
                    
                    <ul className="zy-word-meanings">
                      {word.meaningsTr.map((m, idx) => <li key={idx}>{m}</li>)}
                    </ul>

                    <div className="zy-word-context">
                      <div style={{ marginBottom: '4px', fontStyle: 'italic', color: '#1f2937' }}>"{word.englishSentence}"</div>
                      <div>"{word.turkishSentence}"</div>
                    </div>
                  </div>
                ))}
                
                {filteredStudyWords.length === 0 && (
                  <div style={{ color: '#6b7280', fontSize: '14px', gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
                    Kelime bulunamadı.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedWordObj && popupPosition && (
        <WordDictionaryPopup
          word={selectedWordObj.word}
          englishSentence={selectedWordObj.englishSentence}
          turkishSentence={selectedWordObj.turkishSentence}
          videoId={entry.videoId}
          videoTitle={entry.title}
          timestampMs={selectedWordObj.timestampMs}
          correctedSentenceId={selectedWordObj.correctedSentenceId}
          position={popupPosition}
          positionMode="viewport"
          onClose={() => {
            setSelectedWordObj(null);
            setPopupPosition(null);
          }}
          onSavedChange={(saved, word) => {
            if (saved && word) {
              setEntry(prev => {
                if (!prev) return prev;
                const existing = prev.studyWords?.some(item => item.id === word.id);
                let newWords = prev.studyWords ? [...prev.studyWords] : [];
                if (existing) {
                  newWords = newWords.map(w => w.id === word.id ? word : w);
                } else {
                  newWords.push(word);
                }
                return {
                  ...prev,
                  studyWords: newWords,
                  studyWordCount: newWords.length,
                  hasStudyWords: true
                };
              });
            } else {
               // Reload data to reflect removal
               loadData();
            }
          }}
        />
      )}
    </div>
  );
};
