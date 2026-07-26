import { useState, useEffect } from 'react';
import { HistoryService, SavedSummary } from '../settings/history';
import { formatTime, renderSimpleMarkdown } from '../utils/formatters';
import { SummaryEngine } from '../gem/types';

export const HistoryPage = () => {
  const [summary, setSummary] = useState<SavedSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript'>('summary');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    
    if (id) {
      HistoryService.getSummary(id).then(data => {
        if (data) setSummary(data);
        else setError('Özet bulunamadı.');
        setLoading(false);
      }).catch(err => {
        setError(err.message);
        setLoading(false);
      });
    } else {
      setError('Geçersiz bağlantı (ID eksik).');
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Yükleniyor...</div>;
  }

  if (error || !summary) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--zy-error-text, #dc2626)' }}>{error}</div>;
  }

  const { result } = { result: summary.summary }; // Alias for easier copy-paste from SummaryTab logic
  const isDual = result.outputLanguage === 'tr-en';
  const hasTr = result.outputLanguage.includes('tr');

  const engineLabels: Record<SummaryEngine, string> = {
    'gemini-gem': 'Gemini Gem',
    'openai-compatible': 'API',
    'chrome-local': 'Yerel AI',
  };

  const handleTimeClick = (ms: number | undefined | null) => {
    if (ms == null) return;
    const seconds = Math.floor(ms / 1000);
    // Yeni sekmede youtube sayfasını zaman damgasıyla aç
    const url = new URL(summary.url);
    url.searchParams.set('t', `${seconds}s`);
    window.open(url.toString(), '_blank');
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px' }}>
      
      {/* Üst Kısım: Video Bilgileri */}
      <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--zy-border, #e5e7eb)' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0' }}>{summary.title}</h1>
        <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--zy-text-muted, #6b7280)' }}>
          <a href={summary.url} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', textDecoration: 'none' }}>Videoyu İzle</a>
          <span>•</span>
          <span>{new Date(summary.date).toLocaleString('tr-TR')}</span>
          <span>•</span>
          <span>Motor: {engineLabels[result.providerId as SummaryEngine] || result.providerId}</span>
        </div>
      </div>

      {/* Sekmeler */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', borderBottom: '1px solid var(--zy-border, #e5e7eb)' }}>
        <button 
          onClick={() => setActiveTab('summary')}
          style={{ 
            padding: '8px 4px', 
            background: 'none', 
            border: 'none', 
            borderBottom: activeTab === 'summary' ? '2px solid #ef4444' : '2px solid transparent',
            color: activeTab === 'summary' ? '#ef4444' : 'var(--zy-text-muted, #6b7280)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '15px'
          }}>
          Özet
        </button>
        <button 
          onClick={() => setActiveTab('transcript')}
          style={{ 
            padding: '8px 4px', 
            background: 'none', 
            border: 'none', 
            borderBottom: activeTab === 'transcript' ? '2px solid #ef4444' : '2px solid transparent',
            color: activeTab === 'transcript' ? '#ef4444' : 'var(--zy-text-muted, #6b7280)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '15px'
          }}>
          Transkript
        </button>
      </div>

      {/* İçerik */}
      <div>
        {/* ÖZET SEKMESİ */}
        <div style={{ display: activeTab === 'summary' ? 'block' : 'none' }}>
          
          <div style={{ backgroundColor: 'var(--zy-card-inner, rgba(0,0,0,0.03))', padding: '20px', borderRadius: '8px', border: '1px solid var(--zy-border, rgba(0,0,0,0.06))', marginBottom: '24px' }}>
            <h3 style={{ fontWeight: 700, fontSize: '18px', margin: '0 0 16px 0' }}>Genel Özet</h3>
            {(isDual || hasTr) && (
              <div className="zy-markdown-body" style={{ lineHeight: '1.7', color: 'var(--zy-text, #374151)' }} dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.tr || result.summary.en || '') }} />
            )}
            {isDual && <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', margin: '16px 0' }} />}
            {(isDual || !hasTr) && (
               <div className="zy-markdown-body" style={{ lineHeight: '1.7', color: 'var(--zy-text, #374151)' }} dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.en || result.summary.tr || '') }} />
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
                    <p style={{ margin: '4px 0 0', color: 'var(--zy-text-muted, #6b7280)', fontSize: '14px', lineHeight: '1.6' }}>
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
              <div style={{ borderLeft: '3px solid var(--zy-border, #e5e7eb)', paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    <p style={{ margin: '6px 0 0', color: 'var(--zy-text-muted, #6b7280)', fontSize: '14px', lineHeight: '1.6' }}>
                      {(isDual || hasTr) ? (sec.summary?.tr || sec.summary?.en) : (sec.summary?.en || sec.summary?.tr)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* TRANSKRİPT SEKMESİ */}
        <div style={{ display: activeTab === 'transcript' ? 'block' : 'none' }}>
          {summary.transcript && summary.transcript.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {summary.transcript.map((seg, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '16px', padding: '6px 0', borderBottom: '1px solid var(--zy-border, rgba(0,0,0,0.04))' }}>
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
                  <div style={{ flex: 1, fontSize: '14px', lineHeight: '1.5', color: 'var(--zy-text, #111827)' }}>
                    {seg.cleanText?.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').trim()}
                    {seg.secondaryText && (
                      <div style={{ color: 'var(--zy-text-muted, #6b7280)', marginTop: '2px' }}>
                        {seg.secondaryText.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '').trim()}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--zy-text-muted, #6b7280)' }}>Bu video için transkript kaydedilmemiş.</div>
          )}
        </div>

      </div>
    </div>
  );
};
