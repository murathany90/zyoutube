import { useState, useEffect } from 'react';
import { HistoryService, SavedSummary } from '../settings/history';
import { formatTime, renderSimpleMarkdown } from '../utils/formatters';
import { SummaryEngine } from '../gem/types';
import { CorrectionDB, CorrectedTranscriptRecord } from '../transcript/correction-db';
import { DictionaryDB, StudyWord } from '../dictionary/dictionary-db';

export const HistoryPage = () => {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  
  const [correctedRecord, setCorrectedRecord] = useState<CorrectedTranscriptRecord | null>(null);
  const [correctedLoading, setCorrectedLoading] = useState(true);
  const [correctedViewMode, setCorrectedViewMode] = useState<'corrected' | 'both'>('corrected');

  const [studyWords, setStudyWords] = useState<StudyWord[]>([]);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [wordSearchQuery, setWordSearchQuery] = useState('');
  const [wordTypeFilter, setWordTypeFilter] = useState('');

  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'corrected' | 'words'>('summary');



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

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    
    if (id) {
      HistoryService.getSummary(id).then(data => {
        if (data) {
          setSummary(data);
          // Fetch independently
          CorrectionDB.get(data.videoId).then(res => {
            setCorrectedRecord(res);
            setCorrectedLoading(false);
          }).catch(err => {
            console.error(err);
            setCorrectedLoading(false);
          });
          
          DictionaryDB.getStudyWordsByVideo(data.videoId).then(res => {
            setStudyWords(res);
            setWordsLoading(false);
          }).catch(err => {
            console.error(err);
            setWordsLoading(false);
          });

        } else {
          setSummaryError('Özet bulunamadı.');
          setCorrectedLoading(false);
          setWordsLoading(false);
        }
        setSummaryLoading(false);
      }).catch(err => {
        setSummaryError(err.message);
        setSummaryLoading(false);
        setCorrectedLoading(false);
        setWordsLoading(false);
      });
    } else {
      setSummaryError('Geçersiz bağlantı (ID eksik).');
      setSummaryLoading(false);
      setCorrectedLoading(false);
      setWordsLoading(false);
    }
  }, []);

  const handleTimeClick = (ms: number | undefined | null) => {
    if (ms == null || !summary) return;
    const seconds = Math.floor(ms / 1000);
    const url = new URL(summary.url);
    url.searchParams.set('t', `${seconds}s`);
    window.open(url.toString(), '_blank');
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    // Dictionary popup disabled in History view
  };

  const renderClickableWords = (content: string) => {
    if (!content) return null;
    const wordParts = content.split(/([a-zA-Z]+(?:['’'-][a-zA-Z]+)*)/);
    return wordParts.map((wp, j) => {
      if (/^[a-zA-Z]+(?:['’'-][a-zA-Z]+)*$/.test(wp)) {
        return (
          <span
            key={j}
            className="cursor-pointer hover:bg-blue-100 hover:underline transition-colors"
            style={{ borderRadius: '2px' }}
            onClick={(e) => handleWordClick(e)}
          >
            {wp}
          </span>
        );
      }
      return <span key={j}>{wp}</span>;
    });
  };

  const handleRemoveStudyWord = async (id: string) => {
    try {
      await DictionaryDB.removeStudyWord(id);
      setStudyWords(prev => prev.filter(w => w.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const handleClearAllStudyWords = async () => {
    if (!summary) return;
    if (window.confirm('Bu videoya ait tüm çalışılacak kelimeleri silmek istediğinize emin misiniz?')) {
      try {
        for (const w of studyWords) {
          await DictionaryDB.removeStudyWord(w.id);
        }
        setStudyWords([]);
      } catch (e) {
        console.error(e);
      }
    }
  };

  if (summaryLoading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Özet yükleniyor...</div>;
  }

  if (summaryError || !summary) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#dc2626' }}>{summaryError}</div>;
  }

  const { result } = { result: summary.summary }; 
  const isDual = result.outputLanguage === 'tr-en';
  const hasTr = result.outputLanguage.includes('tr');

  const engineLabels: Record<SummaryEngine, string> = {
    'gemini-gem': 'Gemini Gem',
    'openai-compatible': 'API',
    'chrome-local': 'Yerel AI',
  };

  const filteredStudyWords = studyWords.filter(w => {
    if (wordTypeFilter && w.partOfSpeech !== wordTypeFilter) return false;
    if (wordSearchQuery && !w.displayWord.toLowerCase().includes(wordSearchQuery.toLowerCase())) return false;
    return true;
  });

  const allWordTypes = Array.from(new Set(studyWords.map(w => w.partOfSpeech).filter(Boolean))) as string[];

  const renderTabButton = (id: 'summary' | 'transcript' | 'corrected' | 'words', label: string) => (
    <button 
      onClick={() => handleTabChange(id)}
      style={{ 
        padding: '8px 4px', 
        background: 'none', 
        border: 'none', 
        borderBottom: activeTab === id ? '2px solid #ef4444' : '2px solid transparent',
        color: activeTab === id ? '#ef4444' : '#6b7280',
        fontWeight: 600,
        cursor: 'pointer',
        fontSize: '15px'
      }}>
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      
      <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0' }}>{summary.title}</h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#6b7280' }}>
          <a href={summary.url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', textDecoration: 'none' }}>Videoyu İzle</a>
          <span>•</span>
          <span>{new Date(summary.date).toLocaleString('tr-TR')}</span>
          <span>•</span>
          <span>Motor: {engineLabels[result.providerId as SummaryEngine] || result.providerId}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', borderBottom: '1px solid #e5e7eb' }}>
        {renderTabButton('summary', 'Özet')}
        {renderTabButton('transcript', 'Orijinal Transkript')}
        {renderTabButton('corrected', 'Düzeltilmiş Transkript')}
        {renderTabButton('words', 'Çalışılacak Kelimeler')}
      </div>

      <div>
        <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
          <div style={{ backgroundColor: 'rgba(0,0,0,0.03)', padding: '20px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.06)', marginBottom: '24px' }}>
            <h3 style={{ fontWeight: 700, fontSize: '18px', margin: '0 0 16px 0' }}>Genel Özet</h3>
            {(isDual || hasTr) && (
              <div 
                className="zy-markdown-body" 
                style={{ lineHeight: '1.7', color: '#374151' }} 
                dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.tr || result.summary.en || '') }} 
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.classList.contains('zy-timestamp-link')) {
                    const timeStr = target.getAttribute('data-time');
                    if (timeStr) {
                      const parts = timeStr.split(':').map(Number);
                      let seconds = 0;
                      if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                      else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
                      handleTimeClick(seconds * 1000);
                    }
                  }
                }}
              />
            )}
            {isDual && <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', margin: '16px 0' }} />}
            {(isDual || !hasTr) && (
               <div 
                 className="zy-markdown-body" 
                 style={{ lineHeight: '1.7', color: '#374151' }} 
                 dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.en || result.summary.tr || '') }} 
                 onClick={(e) => {
                   const target = e.target as HTMLElement;
                   if (target.classList.contains('zy-timestamp-link')) {
                     const timeStr = target.getAttribute('data-time');
                     if (timeStr) {
                       const parts = timeStr.split(':').map(Number);
                       let seconds = 0;
                       if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                       else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
                       handleTimeClick(seconds * 1000);
                     }
                   }
                 }}
               />
            )}
          </div>

          {result.keyIdeas?.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontWeight: 700, fontSize: '18px', marginBottom: '12px' }}>Ana Fikirler</h3>
              <ul style={{ paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {result.keyIdeas.map((idea, idx) => (
                  <li key={idx} style={{ paddingLeft: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong>{(isDual || hasTr) ? (idea.title?.tr || idea.title?.en) : (idea.title?.en || idea.title?.tr)}</strong>
                      {idea.startTimeMs != null && (
                        <button onClick={() => handleTimeClick(idea.startTimeMs)}
                          style={{ fontSize: '12px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >[{formatTime(idea.startTimeMs)}]</button>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px', lineHeight: '1.6' }}>
                      {(isDual || hasTr) ? (idea.description?.tr || idea.description?.en) : (idea.description?.en || idea.description?.tr)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.sections?.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontWeight: 700, fontSize: '18px', marginBottom: '12px' }}>Bölümler</h3>
              <div style={{ borderLeft: '3px solid #e5e7eb', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {result.sections.map((sec, idx) => (
                  <div key={idx}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ fontSize: '16px' }}>{(isDual || hasTr) ? (sec.title?.tr || sec.title?.en) : (sec.title?.en || sec.title?.tr)}</strong>
                      {sec.startTimeMs != null && (
                        <button onClick={() => handleTimeClick(sec.startTimeMs)}
                          style={{ fontSize: '12px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >[{formatTime(sec.startTimeMs)}]</button>
                      )}
                    </div>
                    <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '14px', lineHeight: '1.6' }}>
                      {(isDual || hasTr) ? (sec.summary?.tr || sec.summary?.en) : (sec.summary?.en || sec.summary?.tr)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: activeTab === 'transcript' ? 'block' : 'none' }}>
          {summary.transcript && summary.transcript.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {summary.transcript.map((seg, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '16px', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <button 
                    onClick={() => handleTimeClick(seg.startTimeMs)}
                    style={{ 
                      flexShrink: 0, 
                      width: '60px', 
                      color: '#3b82f6', 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      padding: 0,
                      textAlign: 'left',
                      fontSize: '13px',
                      fontFamily: 'monospace'
                    }}>
                    {formatTime(seg.startTimeMs)}
                  </button>
                  <div style={{ flex: 1, fontSize: '14px', lineHeight: '1.5', color: '#111827' }}>
                    {seg.cleanText?.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').trim()}
                    {seg.secondaryText && (
                      <div style={{ color: '#6b7280', marginTop: '2px' }}>
                        {seg.secondaryText.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').trim()}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#6b7280' }}>Bu video için transkript kaydedilmemiş.</div>
          )}
        </div>

        <div style={{ display: activeTab === 'corrected' ? 'block' : 'none' }}>
          {correctedLoading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Düzeltilmiş transkript yükleniyor...</div>
          ) : !correctedRecord || correctedRecord.sentences.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px', textAlign: 'center' }}>Bu video için düzeltilmiş transkript bulunmuyor.</div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                <select 
                  value={correctedViewMode} 
                  onChange={e => setCorrectedViewMode(e.target.value as 'corrected' | 'both')}
                  style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #d1d5db', fontSize: '14px' }}
                >
                  <option value="corrected">Düzeltilmiş</option>
                  <option value="both">Orijinal + Düzeltilmiş</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {correctedRecord.sentences.map((seg) => (
                  <div key={seg.id} style={{ display: 'flex', gap: '16px', padding: '12px', borderBottom: '1px solid rgba(0,0,0,0.04)', backgroundColor: '#f9fafb', borderRadius: '4px' }}>
                    <button 
                      onClick={() => handleTimeClick(seg.startTimeMs)}
                      style={{ flexShrink: 0, width: '60px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontSize: '13px', fontFamily: 'monospace' }}
                    >
                      [{formatTime(seg.startTimeMs)}]
                    </button>
                    <div style={{ flex: 1, fontSize: '14px', lineHeight: '1.5' }}>
                      {correctedViewMode === 'both' && (
                        <div style={{ marginBottom: '12px', paddingLeft: '8px', borderLeft: '2px solid #d1d5db', opacity: 0.7 }}>
                          <div style={{ color: '#4b5563', fontSize: '12px', fontWeight: 'bold' }}>Orijinal TR</div>
                          <div style={{ color: '#6b7280', marginBottom: '6px' }}>{seg.originalTurkish}</div>
                          {seg.originalEnglish && (
                            <>
                              <div style={{ color: '#d97706', fontSize: '12px', fontWeight: 'bold' }}>Orijinal EN</div>
                              <div style={{ color: '#d97706' }}>
                                {renderClickableWords(seg.originalEnglish)}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      
                      <div style={{ color: '#1d4ed8', fontSize: '12px', fontWeight: 'bold' }}>Düzeltilmiş TR</div>
                      <div style={{ color: '#1e3a8a', fontWeight: 500, marginBottom: '6px' }}>{seg.correctedTurkish}</div>
                      
                      {seg.correctedEnglish && (
                        <>
                          <div style={{ color: '#b45309', fontSize: '12px', fontWeight: 'bold' }}>Düzeltilmiş EN</div>
                          <div style={{ color: '#b45309' }}>
                            {renderClickableWords(seg.correctedEnglish)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: activeTab === 'words' ? 'block' : 'none' }}>
          {wordsLoading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Kelimeler yükleniyor...</div>
          ) : studyWords.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px', textAlign: 'center' }}>Bu video için kaydedilmiş çalışılacak kelime bulunmuyor.</div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  placeholder="Kelime arama..." 
                  value={wordSearchQuery}
                  onChange={e => setWordSearchQuery(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '4px', flex: 1 }}
                />
                <select 
                  value={wordTypeFilter}
                  onChange={e => setWordTypeFilter(e.target.value)}
                  style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                >
                  <option value="">Tüm Türler</option>
                  {allWordTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button 
                  onClick={handleClearAllStudyWords}
                  style={{ padding: '8px 16px', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 500 }}
                >
                  Tümünü Temizle
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {filteredStudyWords.map(word => (
                  <div key={word.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', position: 'relative', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" style={{ width: '20px', height: '20px', color: '#eab308' }}>
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <h4 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>{word.displayWord}</h4>
                        {word.partOfSpeech && (
                          <span style={{ fontSize: '11px', padding: '2px 6px', backgroundColor: '#f3f4f6', color: '#4b5563', borderRadius: '4px' }}>
                            {word.partOfSpeech}
                          </span>
                        )}
                      </div>
                      <button 
                        onClick={() => handleRemoveStudyWord(word.id)}
                        style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '4px' }}
                        title="Kaydı Kaldır"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                    
                    {word.phonetic && (
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {word.phonetic}
                        {word.audioUrl && (
                          <button onClick={() => new Audio(word.audioUrl!).play().catch(console.error)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: '2px' }}>
                            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                              <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}

                    <div style={{ marginBottom: '12px' }}>
                      {word.meaningsTr.length > 0 && (
                        <div style={{ fontSize: '13px', color: '#374151', marginBottom: '4px' }}>
                          <strong>TR:</strong> {word.meaningsTr.join(', ')}
                        </div>
                      )}
                      {word.definitionsEn.length > 0 && (
                        <div style={{ fontSize: '12px', color: '#4b5563' }}>
                          <strong>EN:</strong> {word.definitionsEn[0]}
                        </div>
                      )}
                    </div>

                    {(word.synonyms.length > 0 || word.antonyms.length > 0) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                        {word.synonyms.map((s, i) => <span key={`syn-${i}`} style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#eff6ff', color: '#1d4ed8', borderRadius: '12px', border: '1px solid #bfdbfe' }}>{s}</span>)}
                        {word.antonyms.map((a, i) => <span key={`ant-${i}`} style={{ fontSize: '10px', padding: '2px 6px', backgroundColor: '#fef2f2', color: '#b91c1c', borderRadius: '12px', border: '1px solid #fecaca' }}>{a}</span>)}
                      </div>
                    )}

                    <div style={{ backgroundColor: '#f9fafb', padding: '10px', borderRadius: '6px', fontSize: '12px', border: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <strong style={{ color: '#6b7280' }}>Bağlam</strong>
                        <button onClick={() => handleTimeClick(word.timestampMs)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontSize: '11px', fontFamily: 'monospace' }}>
                          [{formatTime(word.timestampMs)}]
                        </button>
                      </div>
                      <div style={{ fontStyle: 'italic', color: '#111827', marginBottom: '4px' }}>"{word.englishSentence}"</div>
                      <div style={{ color: '#4b5563' }}>"{word.turkishSentence}"</div>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
