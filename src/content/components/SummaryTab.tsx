import { useState, useEffect, useRef } from 'react';
import { SummaryResult, AITaskStatus, SummaryRequest } from '../../ai/types';
import { YouTubeTranscriptProvider } from '../../transcript/youtube-provider';
import { AISettingsService } from '../../settings/ai-settings';
import { SummaryEngine } from '../../gem/types';
import { sendRuntimeMessage } from '../runtime-messenger';
import { HistoryService } from '../../settings/history';
import { TranscriptSegment } from '../../transcript/types';
import { renderSimpleMarkdown } from '../../utils/formatters';

export const SummaryTab = ({ videoId, title, url, activeSection = 'summary' }: { videoId: string; title: string; url: string; activeSection?: 'summary' | 'sonuc' | 'cikarimlar' | 'arastir' }) => {
  const [status, setStatus] = useState<AITaskStatus>('queued');
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptSegment[] | null>(null);

  const clearWatchdog = () => {
    if (watchdogTimerRef.current) {
      window.clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (isProcessing) {
      clearWatchdog();
      watchdogTimerRef.current = window.setTimeout(() => {
        setIsProcessing(false);
        setStatus('failed');
        setError('API isteği tamamlanamadı veya arka plan yanıtı alınamadı. Lütfen tekrar deneyin.');
        if (activeTaskIdRef.current) {
          sendRuntimeMessage({ type: 'CANCEL_SUMMARY', taskId: activeTaskIdRef.current }).catch(console.error);
          activeTaskIdRef.current = null;
        }
      }, 195000);
    } else {
      clearWatchdog();
    }
    return () => clearWatchdog();
  }, [isProcessing]);

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
      sendRuntimeMessage({ type: 'CANCEL_SUMMARY', taskId }).catch(console.error);
      setTaskId(null);
      activeTaskIdRef.current = null;
    }
    setCurrentTranscript(null);
  }, [videoId]);

  // İlerleme ve sonuç dinleyicisi
  useEffect(() => {
    const listener = (message: any) => {
      if (!activeTaskIdRef.current || message.taskId !== activeTaskIdRef.current) return;
      if (message.type === 'SUMMARY_PROGRESS') {
        setStatus(message.status);
        if (message.message) setProgressMessage(message.message);
      } else if (message.type === 'SUMMARY_COMPLETED') {
        setResult(message.result);
        setStatus('completed');
        setIsProcessing(false);
        // Kaydet
        if (currentTranscript) {
          HistoryService.saveSummary(
            message.result,
            { videoId, title, url },
            currentTranscript
          ).catch(console.error);
        }
      } else if (message.type === 'SUMMARY_FAILED') {
        setError(message.error?.userMessage || 'Bir hata oluştu.');
        setStatus('failed');
        setIsProcessing(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [videoId, title, url, currentTranscript]);

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
      setCurrentTranscript(transcriptResult.segments);

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
      activeTaskIdRef.current = request.taskId;
      setProgressMessage(selectedEngine === 'gemini-gem' ? 'Gemini Gem başlatılıyor...' : 'AI Sağlayıcı aranıyor...');

      const startResponse = await sendRuntimeMessage({
        type: 'START_SUMMARY',
        request,
      });

      if (!startResponse?.success) {
        throw new Error(startResponse?.error || 'Özet görevi başlatılamadı.');
      }
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
      sendRuntimeMessage({ type: 'CANCEL_SUMMARY', taskId }).catch(console.error);
      setIsProcessing(false);
      setStatus('cancelled');
      setProgressMessage('İptal edildi.');
      activeTaskIdRef.current = null;
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

        {/* Eski JSON yapısı (Geriye Dönük Uyumluluk) */}
        {(result.keyIdeas?.length > 0 || result.sections?.length > 0) ? (
          <>
            <div style={{ backgroundColor: 'var(--zy-card-inner, rgba(0,0,0,0.03))', padding: '12px', borderRadius: '8px', border: '1px solid var(--zy-border, rgba(0,0,0,0.06))' }}>
              <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>Özet</h3>
              {(isDual || hasTr) && (
                <div className="zy-markdown-body" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(result.summary.tr || result.summary.en || '') }} />
              )}
            </div>
            {result.keyIdeas?.length > 0 && (
              <div>
                <h3 style={{ fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>💡 Ana Fikirler</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {result.keyIdeas.map((ki, idx) => (
                    <li key={idx} style={{ padding: '8px', backgroundColor: 'var(--zy-card-bg, #fff)', border: '1px solid var(--zy-border, #e5e7eb)', borderRadius: '6px' }}>
                      <strong>{(isDual || hasTr) ? (ki.title?.tr || ki.title?.en) : (ki.title?.en || ki.title?.tr)}</strong>
                      <p style={{ margin: '4px 0 0', color: 'var(--zy-text-muted, #6b7280)', fontSize: '12px' }}>
                        {(isDual || hasTr) ? (ki.description?.tr || ki.description?.en) : (ki.description?.en || ki.description?.tr)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          /* Yeni Markdown Yapı (Ana Sekmelere Bağlı) */
          <div>
            <div 
              className="zy-markdown-body" 
              style={{ lineHeight: '1.7', color: 'var(--zy-text, #374151)', wordBreak: 'break-word', overflowWrap: 'break-word' }} 
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
              dangerouslySetInnerHTML={{ 
                __html: renderSimpleMarkdown((() => {
                  let rawText = (isDual || hasTr) ? (result.summary.tr || '') : (result.summary.en || '');
                  
                  // Sekmelere göre parçalama (Bitişik başlıkları da ayrıştırarak düzgün markdown H3'e çeviririz)
                  const getSection = (startMarker: string, endMarkers: string[]) => {
                    let startIndex = rawText.indexOf(startMarker);
                    if (startIndex === -1) return '';
                    let endIndex = rawText.length;
                    for (const em of endMarkers) {
                      const idx = rawText.indexOf(em, startIndex + startMarker.length);
                      if (idx !== -1 && idx < endIndex) {
                        endIndex = idx;
                      }
                    }
                    return rawText.substring(startIndex, endIndex).trim();
                  };

                  let sectionText = rawText;
                  if (activeSection === 'summary') {
                    const p1 = getSection('📝 Genel Özet', ['🎯 Sonuç', '💡 Çıkarımlar', '🔍 Araştır']);
                    sectionText = p1 || rawText; // Bulamazsa tümünü göster
                  } else if (activeSection === 'sonuc') {
                    sectionText = getSection('🎯 Sonuç', ['💡 Çıkarımlar', '🔍 Araştır', '📝 Genel Özet']);
                  } else if (activeSection === 'cikarimlar') {
                    sectionText = getSection('💡 Çıkarımlar', ['🔍 Araştır', '📝 Genel Özet', '🎯 Sonuç']);
                  } else if (activeSection === 'arastir') {
                    sectionText = getSection('🔍 Araştır', ['📝 Genel Özet', '🎯 Sonuç', '💡 Çıkarımlar']);
                  }
                  
                  // Başlıkların başına ve sonuna yeni satır ekleyip markdown başlığı (##) yapıyoruz
                  // Böylece scraper newline'ları silmiş olsa bile görüntü düzeliyor
                  return sectionText
                    .replace(/\s*(📝 Genel Özet)\s*/g, '\n\n## $1\n\n')
                    .replace(/\s*(⏱️ Zaman Damgalı Detaylı Özet)\s*/g, '\n\n## $1\n\n')
                    .replace(/\s*(🎯 Sonuç)\s*/g, '\n\n## $1\n\n')
                    .replace(/\s*(💡 Çıkarımlar)\s*/g, '\n\n## $1\n\n')
                    .replace(/\s*(🔍 Araştır)\s*/g, '\n\n## $1\n\n')
                    .trim();
                })())
              }} 
            />
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



