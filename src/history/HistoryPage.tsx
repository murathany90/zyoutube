import React, { useState, useEffect } from 'react';
import { LibraryService, VideoLibraryEntry } from './library-service';
import { formatTime } from '../utils/formatters';
import { DictionaryDB } from '../dictionary/dictionary-db';
import { WordDictionaryPopup } from '../content/components/WordDictionaryPopup';
import './history.css';

export const HistoryPage = () => {
  const [entry, setEntry] = useState<VideoLibraryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'corrected' | 'words'>('summary');
  const [wordSearchQuery, setWordSearchQuery] = useState('');
  
  // Dictionary Popup State
  const [selectedWordObj, setSelectedWordObj] = useState<{word: string, englishSentence: string, turkishSentence: string, correctedSentenceId?: string} | null>(null);
  const [popupPosition, setPopupPosition] = useState<{top: number, left: number} | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (['summary', 'transcript', 'corrected', 'words'].includes(hash)) {
      setActiveTab(hash as any);
    }
  }, []);

  const handleTabChange = (tab: 'summary' | 'transcript' | 'corrected' | 'words') => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  const loadData = async () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const id = urlParams.get('videoId') || urlParams.get('id');
      
      if (!id) {
        setError('Geçersiz bağlantı (Video ID eksik).');
        setLoading(false);
        return;
      }

      const entries = await LibraryService.getEntries();
      const foundEntry = entries.find(e => e.videoId === id || (e.savedSummary && e.savedSummary.id === id));
      
      if (foundEntry) {
        setEntry(foundEntry);
        
        // Auto-select tab if summary doesn't exist
        if (!foundEntry.hasSummary && !window.location.hash) {
          if (foundEntry.hasCorrectedTranscript) setActiveTab('corrected');
          else if (foundEntry.hasOriginalTranscript) setActiveTab('transcript');
          else if (foundEntry.hasStudyWords) setActiveTab('words');
        }
      } else {
        setError('Kayıt bulunamadı.');
      }
    } catch (err: any) {
      setError(err.message || 'Bilinmeyen hata');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const handleMessage = (msg: any) => {
      if (msg.type === 'LIBRARY_ENTRY_UPDATED' && entry && msg.videoId === entry.videoId) {
        loadData();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [entry]);

  const handleTimeClick = (ms: number | undefined | null) => {
    if (ms == null || !entry) return;
    const seconds = Math.floor(ms / 1000);
    // use youtube url
    const url = new URL(`https://www.youtube.com/watch?v=${entry.videoId}`);
    url.searchParams.set('t', `${seconds}s`);
    window.open(url.toString(), '_blank');
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, text: string, enSentence: string, trSentence: string, sentenceId?: string) => {
    e.stopPropagation();
    
    // Position slightly below and right of the click
    const x = e.clientX;
    const y = e.clientY + 15;
    
    setSelectedWordObj({
      word: text.trim(),
      englishSentence: enSentence,
      turkishSentence: trSentence,
      correctedSentenceId: sentenceId
    });
    setPopupPosition({ top: y, left: x });
  };

  const renderClickableWords = (content: string, enSentence: string, trSentence: string, sentenceId?: string) => {
    if (!content) return null;
    const wordParts = content.split(/([a-zA-Z]+(?:['’'-][a-zA-Z]+)*)/);
    return wordParts.map((wp, j) => {
      if (/^[a-zA-Z]+(?:['’'-][a-zA-Z]+)*$/.test(wp)) {
        return (
          <span 
            key={j} 
            className="zy-clickable-word"
            onClick={(e) => handleWordClick(e, wp, enSentence, trSentence, sentenceId)}
          >
            {wp}
          </span>
        );
      }
      return <span key={j}>{wp}</span>;
    });
  };

  const handleDelete = async () => {
    if (!entry) return;
    if (confirm('Bu kaydı tamamen silmek istediğinize emin misiniz?')) {
      await LibraryService.deleteVideoEntry(entry.videoId);
      window.close();
    }
  };

  const handleExport = (type: 'md' | 'json') => {
    if (!entry) return;
    
    let contentStr = '';
    let mimeType = 'text/plain';
    let ext = type;

    if (type === 'json') {
      contentStr = JSON.stringify(entry, null, 2);
      mimeType = 'application/json';
    } else if (type === 'md') {
      mimeType = 'text/markdown';
      contentStr = `# ${entry.title}\n\n`;
      
      if (entry.hasSummary && entry.savedSummary?.summary) {
        contentStr += `## Özet\n`;
        if (entry.savedSummary.summary.summary?.tr) {
           contentStr += entry.savedSummary.summary.summary.tr + '\n\n';
        }
        if (entry.savedSummary.summary.keyIdeas) {
           contentStr += `### Önemli Noktalar\n`;
           entry.savedSummary.summary.keyIdeas.forEach(k => {
             contentStr += `- **${k.title?.tr || k.title?.en}**: ${k.description?.tr || k.description?.en}\n`;
           });
           contentStr += '\n';
        }
      }
      
      if (entry.hasCorrectedTranscript && entry.correctedTranscript?.sentences) {
        contentStr += `## Transkript (Düzeltilmiş)\n\n`;
        entry.correctedTranscript.sentences.forEach(s => {
          contentStr += `- [${formatTime(s.startTimeMs || 0)}] **${s.correctedTurkish}**\n  *${s.correctedEnglish}*\n\n`;
        });
      }
      
      if (entry.hasStudyWords && entry.studyWords) {
        contentStr += `## Çalışılacak Kelimeler\n\n`;
        entry.studyWords.forEach(w => {
           contentStr += `- **${w.displayWord}** (${w.meaningsTr.join(', ')})\n`;
        });
      }
    }
    
    const blob = new Blob([contentStr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entry.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${type}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
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
        {entry.hasSummary && (
          <button className={`zy-history-tab ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => handleTabChange('summary')}>
            Özet Detayı
          </button>
        )}
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
          {activeTab === 'summary' && savedSummary && savedSummary.summary && (
            <div className="zy-summary-card">
              <h2 className="zy-summary-section-title">Kısa Özet</h2>
              {savedSummary.summary.summary?.tr && (
                <div className="zy-summary-text">{savedSummary.summary.summary.tr}</div>
              )}
              {savedSummary.summary.summary?.en && (
                <div className="zy-summary-text" style={{ fontStyle: 'italic', color: '#6b7280' }}>
                  {savedSummary.summary.summary.en}
                </div>
              )}

              {savedSummary.summary.keyIdeas && savedSummary.summary.keyIdeas.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                  <h2 className="zy-summary-section-title">Önemli Noktalar</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {savedSummary.summary.keyIdeas.map((idea, i) => (
                      <div key={i}>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 4px 0', color: '#1f2937' }}>
                          {idea.title?.tr || idea.title?.en}
                        </h3>
                        <p style={{ fontSize: '14px', color: '#4b5563', margin: 0, lineHeight: 1.5 }}>
                          {idea.description?.tr || idea.description?.en}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'corrected' && correctedTranscript && (
            <div className="zy-summary-card" style={{ padding: 0 }}>
              {correctedTranscript.sentences.map((sentence, i) => (
                <div key={i} className="zy-sentence-row">
                  <div className="zy-sentence-time" onClick={() => handleTimeClick(sentence.startTimeMs)}>
                    {formatTime(sentence.startTimeMs || 0)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <div className="zy-sentence-tr">{sentence.correctedTurkish}</div>
                    <div className="zy-sentence-en">
                      {renderClickableWords(sentence.correctedEnglish || '', sentence.correctedEnglish || '', sentence.correctedTurkish || '', sentence.id)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'transcript' && savedSummary && (
            <div className="zy-summary-card" style={{ padding: 0 }}>
               {savedSummary.transcript.map((item, i) => (
                 <div key={i} className="zy-sentence-row">
                   <div className="zy-sentence-time" onClick={() => handleTimeClick(item.startTimeMs)}>
                     {formatTime(item.startTimeMs || 0)}
                   </div>
                   <div className="zy-sentence-tr">{item.text}</div>
                 </div>
               ))}
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
                                 return {
                                   ...prev,
                                   studyWords: prev.studyWords?.filter(w => w.id !== word.id),
                                   studyWordCount: prev.studyWordCount - 1
                                 };
                               });
                               chrome.runtime.sendMessage({ type: 'LIBRARY_ENTRY_UPDATED', videoId: entry.videoId, reason: 'word_removed' }).catch(() => {});
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
          timestampMs={0}
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
                return {
                  ...prev,
                  studyWords: [...(prev.studyWords || []), word],
                  studyWordCount: prev.studyWordCount + 1,
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
