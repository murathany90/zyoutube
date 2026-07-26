import { useState, useEffect } from 'react';
import { SummaryResult, AITaskStatus, SummaryRequest } from '../../ai/types';
import { YouTubeTranscriptProvider } from '../../transcript/youtube-provider';
import { AISettingsService } from '../../settings/ai-settings';
import { SummaryEngine } from '../../gem/types';
import { sendRuntimeMessage } from '../runtime-messenger';

export const SummaryTab = ({ videoId, title, url }: { videoId: string; title: string; url: string }) => {
  const [status, setStatus] = useState<AITaskStatus>('queued');
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  const [selectedEngine, setSelectedEngine] = useState<SummaryEngine>('gemini-gem');
  const [selectedLength, setSelectedLength] = useState<'short' | 'standard' | 'detailed'>('standard');
  const [selectedLanguage, setSelectedLanguage] = useState<'tr' | 'en' | 'tr-en'>('tr-en');

  useEffect(() => {
    AISettingsService.getSettings().then(s => {
      setSelectedEngine(s.defaultEngine);
      setSelectedLength(s.defaultLength);
      setSelectedLanguage(s.defaultLanguage);
    });
  }, []);

  // Video değişiminde sıfırla
  useEffect(() => {
    setStatus('queued');
    setProgressMessage('');
    setResult(null);
    setError(null);
    setIsProcessing(false);
    if (taskId) {
      sendRuntimeMessage({ type: 'CANCEL_SUMMARY', taskId }).catch(() => {});
      setTaskId(null);
    }
  }, [videoId]);

  // İlerleme ve sonuç dinleyicisi
  useEffect(() => {
    if (!taskId) return;
    const listener = (message: any) => {
      if (message.taskId !== taskId) return;
      if (message.type === 'SUMMARY_PROGRESS') {
        setStatus(message.status);
        if (message.message) setProgressMessage(message.message);
      } else if (message.type === 'SUMMARY_COMPLETED') {
        setResult(message.result);
        setStatus('completed');
        setIsProcessing(false);
      } else if (message.type === 'SUMMARY_FAILED') {
        setError(message.error.userMessage);
        setStatus('failed');
        setIsProcessing(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [taskId]);

  const startSummary = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      setStatus('preparing');
      setProgressMessage('Transkript çekiliyor...');

      const provider = new YouTubeTranscriptProvider();
      const tracks = await provider.getAvailableTracks(videoId);
      
      const preferredLang = selectedLanguage.includes('tr') ? 'tr' : 'en';
      let track = tracks.find(t => t.languageCode === preferredLang && t.sourceType === 'manual');
      if (!track) track = tracks.find(t => t.languageCode === preferredLang);
      if (!track) track = tracks.find(t => t.sourceType === 'manual');
      if (!track) track = tracks[0];
      
      const transcriptResult = await provider.fetchTranscript(videoId, track);

      const request: SummaryRequest = {
        taskId: `task_${Date.now()}`,
        video: { videoId, title, url },
        transcript: {
          languageCode: track.languageCode,
          sourceType: track.sourceType || 'unknown',
          qualityLevel: transcriptResult.quality?.level || 'medium',
          qualityReasons: transcriptResult.quality?.reasons || [],
          segments: transcriptResult.segments,
        },
        options: {
          length: selectedLength,
          outputLanguage: selectedLanguage,
          includeKeyIdeas: true,
          includeSections: true,
          includeActionItems: true,
        },
        engine: selectedEngine,
      };

      setTaskId(request.taskId);
      setProgressMessage(selectedEngine === 'gemini-gem' ? 'Gemini Gem başlatılıyor...' : 'AI Sağlayıcı aranıyor...');

      sendRuntimeMessage({
        type: 'START_SUMMARY',
        request,
      }).catch(() => {});
    } catch (e: any) {
      let msg = e.message || 'Transkript çekilemedi.';
      if (e.diagnostics) {
         msg += `\n[Tanılama: ${e.diagnostics.extractionSource}, Tracks: ${e.diagnostics.trackCount}]`;
      }
      setError(msg);
      setIsProcessing(false);
      setStatus('failed');
    }
  };

  const cancelSummary = () => {
    if (taskId) {
      sendRuntimeMessage({ type: 'CANCEL_SUMMARY', taskId }).catch(() => {});
      setIsProcessing(false);
      setStatus('cancelled');
      setProgressMessage('İptal edildi.');
    }
  };

  const handleTimeClick = (ms: number | undefined | null) => {
    if (ms == null) return;
    const seconds = Math.floor(ms / 1000);
    const videoElement = document.querySelector('video');
    if (videoElement) {
      videoElement.currentTime = seconds;
      videoElement.play();
    }
  };

  const engineLabels: Record<SummaryEngine, string> = {
    'gemini-gem': 'Gemini Gem',
    'openai-compatible': 'API',
    'chrome-local': 'Yerel AI',
  };

  // ─── İlk ekran: motor seçimi ve başlatma ───
  if (!isProcessing && !result && status !== 'cancelled' && status !== 'failed') {
    return (
      <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '3px', color: 'var(--zy-text-muted, #6b7280)' }}>Motor</label>
            <select value={selectedEngine} onChange={e => setSelectedEngine(e.target.value as SummaryEngine)}
              style={{ width: '100%', fontSize: '12px', padding: '5px', border: '1px solid var(--zy-border, #d1d5db)', borderRadius: '4px', backgroundColor: 'var(--zy-card-bg, #fff)', color: 'var(--zy-text, #111827)' }}
            >
              <option value="gemini-gem">Gemini Gem</option>
              <option value="openai-compatible">API</option>
              <option value="chrome-local">Yerel AI</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '3px', color: 'var(--zy-text-muted, #6b7280)' }}>Uzunluk</label>
            <select value={selectedLength} onChange={e => setSelectedLength(e.target.value as any)}
              style={{ width: '100%', fontSize: '12px', padding: '5px', border: '1px solid var(--zy-border, #d1d5db)', borderRadius: '4px', backgroundColor: 'var(--zy-card-bg, #fff)', color: 'var(--zy-text, #111827)' }}
            >
              <option value="short">Kısa</option>
              <option value="standard">Standart</option>
              <option value="detailed">Ayrıntılı</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '3px', color: 'var(--zy-text-muted, #6b7280)' }}>Dil</label>
            <select value={selectedLanguage} onChange={e => setSelectedLanguage(e.target.value as any)}
              style={{ width: '100%', fontSize: '12px', padding: '5px', border: '1px solid var(--zy-border, #d1d5db)', borderRadius: '4px', backgroundColor: 'var(--zy-card-bg, #fff)', color: 'var(--zy-text, #111827)' }}
            >
              <option value="tr">Türkçe</option>
              <option value="en">English</option>
              <option value="tr-en">Türkçe + English</option>
            </select>
          </div>
        </div>

        <p style={{ color: 'var(--zy-text-muted, #6b7280)', fontSize: '12px' }}>Bu video için henüz bir özet oluşturulmadı.</p>
        <button onClick={startSummary}
          style={{
            padding: '8px 20px', backgroundColor: '#ef4444', color: '#ffffff', border: 'none',
            borderRadius: '20px', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'background 0.15s', alignSelf: 'flex-start',
          }}
        >
          {selectedEngine === 'gemini-gem' ? 'Gemini Gem ile Özetle' : 'Şimdi Özetle'}
        </button>
      </div>
    );
  }

  // ─── İşleniyor ───
  if (isProcessing) {
    return (
      <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '32px', height: '32px', border: '3px solid var(--zy-border, #fecaca)', borderTop: '3px solid #ef4444',
          borderRadius: '50%', animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontWeight: 700, fontSize: '14px', margin: '0 0 4px' }}>İşleniyor</p>
          <p style={{ fontSize: '12px', color: 'var(--zy-text-muted, #6b7280)' }}>{progressMessage}</p>
        </div>
        <button onClick={cancelSummary}
          style={{
            padding: '5px 14px', fontSize: '12px', color: 'var(--zy-text-muted, #6b7280)', background: 'none',
            border: '1px solid var(--zy-border, #d1d5db)', borderRadius: '4px', cursor: 'pointer',
          }}
        >İptal Et</button>
      </div>
    );
  }

  // ─── Hata ───
  if (error) {
    return (
      <div style={{ padding: '12px', border: '1px solid var(--zy-error-border, #fecaca)', backgroundColor: 'var(--zy-error-bg, #fef2f2)', borderRadius: '8px', fontSize: '13px', color: 'var(--zy-error-text, #dc2626)' }}>
        <p style={{ fontWeight: 700, marginBottom: '6px' }}>Özetleme Başarısız</p>
        <p>{error}</p>
        <button onClick={startSummary}
          style={{ marginTop: '10px', padding: '5px 12px', fontSize: '12px', backgroundColor: 'var(--zy-error-bg, #fef2f2)', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer' }}
        >Tekrar Dene</button>
      </div>
    );
  }

  // ─── İptal ───
  if (status === 'cancelled') {
    return (
      <div style={{ padding: '12px', fontSize: '13px', color: 'var(--zy-text-muted, #6b7280)' }}>
        <p>İşlem kullanıcı tarafından iptal edildi.</p>
        <button onClick={startSummary}
          style={{ marginTop: '8px', padding: '5px 12px', fontSize: '12px', backgroundColor: 'var(--zy-item-bg, #f3f4f6)', border: 'none', borderRadius: '4px', fontWeight: 600, cursor: 'pointer' }}
        >Tekrar Dene</button>
      </div>
    );
  }

  // ─── Sonuç ───
  if (result) {
    const isDual = result.outputLanguage === 'tr-en';
    const hasTr = result.outputLanguage.includes('tr');

    return (
      <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={startSummary} style={{ fontSize: '11px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
            Yeniden Oluştur
          </button>
        </div>

        {/* Özet */}
        <div style={{ backgroundColor: 'var(--zy-card-inner, rgba(0,0,0,0.03))', padding: '12px', borderRadius: '8px', border: '1px solid var(--zy-border, rgba(0,0,0,0.06))' }}>
          <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Özet</h3>
          {(isDual || hasTr) && (
            <div style={{ lineHeight: '1.6', color: 'var(--zy-text, #374151)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.tr || result.summary.en || '') }} />
          )}
          {isDual && <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', margin: '8px 0' }} />}
          {(isDual || !hasTr) && (
             <div style={{ lineHeight: '1.6', color: 'var(--zy-text, #374151)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.en || result.summary.tr || '') }} />
          )}
        </div>

        {/* Ana Fikirler */}
        {result.keyIdeas?.length > 0 && (
          <div>
            <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>💡 Ana Fikirler</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {result.keyIdeas.map((ki, idx) => (
                <li key={idx} style={{ padding: '8px', backgroundColor: 'var(--zy-card-bg, #fff)', border: '1px solid var(--zy-border, #e5e7eb)', borderRadius: '6px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  {ki.startTimeMs != null && (
                    <button onClick={() => handleTimeClick(ki.startTimeMs)}
                      style={{ fontSize: '11px', backgroundColor: 'var(--zy-item-bg, #f3f4f6)', padding: '2px 6px', borderRadius: '3px', border: 'none', color: 'var(--zy-text-muted, #6b7280)', cursor: 'pointer', flexShrink: 0 }}
                    >{formatTime(ki.startTimeMs)}</button>
                  )}
                  <div>
                    <strong>{(isDual || hasTr) ? (ki.title?.tr || ki.title?.en) : (ki.title?.en || ki.title?.tr)}</strong>
                    <p style={{ margin: '4px 0 0', color: 'var(--zy-text-muted, #6b7280)', fontSize: '12px' }}>
                      {(isDual || hasTr) ? (ki.description?.tr || ki.description?.en) : (ki.description?.en || ki.description?.tr)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Bölümler */}
        {result.sections?.length > 0 && (
          <div>
            <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Bölümler</h3>
            <div style={{ borderLeft: '2px solid var(--zy-border, #e5e7eb)', paddingLeft: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {result.sections.map((sec, idx) => (
                <div key={idx}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong>{(isDual || hasTr) ? (sec.title?.tr || sec.title?.en) : (sec.title?.en || sec.title?.tr)}</strong>
                    {sec.startTimeMs != null && (
                      <button onClick={() => handleTimeClick(sec.startTimeMs)}
                        style={{ fontSize: '10px', color: 'var(--zy-text-muted, #6b7280)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >[{formatTime(sec.startTimeMs)}]</button>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0', color: 'var(--zy-text-muted, #6b7280)', fontSize: '12px' }}>
                    {(isDual || hasTr) ? (sec.summary?.tr || sec.summary?.en) : (sec.summary?.en || sec.summary?.tr)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meta bilgi */}
        <div style={{ fontSize: '11px', color: 'var(--zy-text-muted, #9ca3af)', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--zy-border, #e5e7eb)', paddingTop: '8px' }}>
          <span>Motor: {engineLabels[result.providerId as SummaryEngine] || result.providerId}</span>
          {result.usage && <span>Tokens: {result.usage.inputTokens} / {result.usage.outputTokens}</span>}
        </div>
      </div>
    );
  }

  return null;
};

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function renderSimpleMarkdown(text: string): string {
  if (!text) return '';
  // Escape HTML first to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  // Headers (## Header)
  html = html.replace(/^### (.*?)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.*?)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.*?)$/gm, '<h2>$1</h2>');
  
  // Bold (**text**)
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Italic (*text*)
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  
  return html;
}

