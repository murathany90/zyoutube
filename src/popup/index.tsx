import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import '../styles/popup.css';
import { AISettingsService } from '../settings/ai-settings';
import { ExtensionSettings, DEFAULT_SETTINGS, AIProviderConfig, AIProviderId } from '../settings/types';
import { GemSettingsService } from '../gem/settings';
import { GemSettings, DEFAULT_GEM_SETTINGS, PanelSettings, DEFAULT_PANEL_SETTINGS, SummaryEngine } from '../gem/types';
import { ConfigValidator } from '../settings/validation';
import { LocalAIChecker, LocalAIStatus } from '../settings/local-ai';

// ─── Toggle Component ──────────────────────────────

const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 0' }}>
    <span style={{ fontSize: '13px', fontWeight: 500 }}>{label}</span>
    <div onClick={(e) => { e.preventDefault(); onChange(!checked); }}
      style={{
        width: '40px', height: '22px', borderRadius: '11px',
        backgroundColor: checked ? '#ef4444' : 'var(--zy-border, #d1d5db)',
        position: 'relative', transition: 'background-color 0.2s', cursor: 'pointer', flexShrink: 0,
      }}>
      <div style={{
        width: '18px', height: '18px', borderRadius: '9px', backgroundColor: 'var(--zy-card-bg, #fff)',
        position: 'absolute', top: '2px', left: checked ? '20px' : '2px',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  </label>
);

// ─── Main Popup ─────────────────────────────────────

const Popup = () => {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [gemSettings, setGemSettings] = useState<GemSettings>(DEFAULT_GEM_SETTINGS);
  const [panelSettings, setPanelSettings] = useState<PanelSettings>(DEFAULT_PANEL_SETTINGS);
  const [activeTab, setActiveTab] = useState<'general' | 'gemini-gem' | 'api' | 'local'>('general');
  const [localStatus, setLocalStatus] = useState<LocalAIStatus | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [gemUrlError, setGemUrlError] = useState<string>('');

  useEffect(() => {
    AISettingsService.getSettings().then(s => setSettings(s));
    GemSettingsService.getGemSettings().then(g => setGemSettings(g));
    GemSettingsService.getPanelSettings().then(p => setPanelSettings(p));
    LocalAIChecker.checkStatus().then(st => setLocalStatus(st));
    // Migration
    GemSettingsService.migrateFromGeminiApi();
  }, []);

  const showSaved = () => {
    setSaveStatus('✓ Kaydedildi');
    setTimeout(() => setSaveStatus(''), 2500);
  };

  const saveGeneralSettings = async (newSettings: ExtensionSettings) => {
    await AISettingsService.saveSettings(newSettings);
    setSettings(newSettings);
    showSaved();
  };

  const saveGem = async (newGem: GemSettings) => {
    await GemSettingsService.saveGemSettings(newGem);
    setGemSettings(newGem);
    showSaved();
  };

  const togglePanelEnabled = async (enabled: boolean) => {
    await chrome.storage.local.set({ panelEnabled: enabled });
    setPanelSettings(prev => ({ ...prev, enabled }));
    showSaved();
    // Broadcast to all YouTube tabs
    const msgType = enabled ? 'START_EXTENSION' : 'STOP_EXTENSION';
    chrome.tabs?.query({ url: 'https://*.youtube.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: msgType }).catch(() => {});
      });
    });
  };

  const updateProvider = async (id: AIProviderId, updates: Partial<AIProviderConfig>) => {
    if (id === 'openai-compatible' && updates.baseUrl) {
      try {
        const url = new URL(updates.baseUrl);
        const origin = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/*`;
        if (chrome.permissions?.request) {
          await new Promise(resolve => {
            chrome.permissions.request({ origins: [origin] }, (granted) => resolve(granted));
          });
        }
      } catch {
        // Invalid URL
      }
    }
    const newProviders = { ...settings.providers };
    newProviders[id] = { ...newProviders[id], ...updates };
    saveGeneralSettings({ ...settings, providers: newProviders });
  };

  const [testStatus, setTestStatus] = useState<{type: 'loading'|'success'|'error', message: string, latency?: number, limits?: string, aiResponse?: string} | null>(null);

  const testConnection = (id: AIProviderId) => {
    const config = settings.providers[id];
    const validation = ConfigValidator.validate(config || {});
    if (!validation.isValid) {
      setTestStatus({ type: 'error', message: 'Geçersiz Ayarlar:\n' + validation.errors.join('\n') });
      return;
    }
    
    setTestStatus({ type: 'loading', message: 'Bağlantı test ediliyor, lütfen bekleyin...' });
    // Save settings before testing
    saveGeneralSettings(settings).then(() => {
      chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', providerId: id }, (response) => {
        if (chrome.runtime.lastError) {
          setTestStatus({ type: 'error', message: 'Bağlantı hatası: ' + chrome.runtime.lastError.message });
        } else if (response && response.success) {
          setTestStatus({ 
            type: 'success', 
            message: 'Bağlantı Başarılı!',
            latency: response.latencyMs,
            limits: response.limits,
            aiResponse: response.message
          });
        } else {
          setTestStatus({ type: 'error', message: `Bağlantı Başarısız!\nHata: ${response?.message || 'Bilinmeyen hata'}` });
        }
      });
    });
  };

  const validateGemUrl = (url: string) => {
    if (!url) { setGemUrlError(''); return; }
    const result = GemSettingsService.validateGemUrl(url);
    setGemUrlError(result.valid ? '' : (result.error || ''));
  };

  const tabItems: { id: typeof activeTab; label: string }[] = [
    { id: 'general', label: 'Genel' },
    { id: 'gemini-gem', label: 'Gemini Gem' },
    { id: 'api', label: 'API' },
    { id: 'local', label: 'Yerel AI' },
  ];

  const inputStyle: React.CSSProperties = {
    width: '100%', border: '1px solid #d1d5db', borderRadius: '6px', padding: '7px 10px',
    fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  const sectionTitle: React.CSSProperties = {
    fontSize: '12px', fontWeight: 700, color: 'var(--zy-text-muted, #6b7280)', marginBottom: '8px', marginTop: '16px',
    textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  return (
    <div className="popup-shell" style={{
      width: '480px', height: '600px',
      display: 'flex', flexDirection: 'column',
      backgroundColor: '#f9fafb', color: '#1f2937',
      overflow: 'hidden',
    }}>
      {/* Fixed Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', backgroundColor: 'var(--zy-card-bg, #fff)',
        borderBottom: '1px solid #e5e7eb', flexShrink: 0,
      }}>
        <h1 style={{ fontSize: '15px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#ef4444">
            <path d="M21.583 6.846c-.204-1.396-1.145-2.52-2.368-2.736C17.119 3.75 12 3.75 12 3.75s-5.12 0-7.215.36c-1.223.216-2.164 1.34-2.368 2.736C2 8.71 2 12 2 12s0 3.29.417 5.154c.204 1.396 1.145 2.52 2.368 2.736 2.095.36 7.215.36 7.215.36s5.12 0 7.215-.36c1.223-.216 2.164-1.34 2.368-2.736.417-1.864.417-5.154.417-5.154s0-3.29-.417-5.154zM9.996 15.596V8.404L15.811 12l-5.815 3.596z" />
          </svg>
          ZYouTube Ayarları
        </h1>
        {saveStatus && <span style={{ fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>{saveStatus}</span>}
      </header>

      {/* Fixed Tabs */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #e5e7eb',
        backgroundColor: 'var(--zy-card-bg, #fff)', flexShrink: 0,
      }}>
        {tabItems.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: '9px 4px', fontSize: '12px', fontWeight: 600,
              background: 'none', border: 'none',
              borderBottom: activeTab === t.id ? '2px solid #ef4444' : '2px solid transparent',
              color: activeTab === t.id ? '#ef4444' : 'var(--zy-text-muted, #6b7280)',
              cursor: 'pointer', transition: 'color 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Scrollable Content */}
      <div className="popup-content" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px',
      }}>

        {/* ─── GENEL ─────────────────────── */}
        {activeTab === 'general' && (
          <div>
            <div style={sectionTitle}>Panel Ayarları</div>
            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px' }}>
              <Toggle label="Eklenti Aktif" checked={panelSettings.enabled} onChange={v => togglePanelEnabled(v)} />
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                Panel, YouTube watch sayfalarında otomatik olarak görünür. Kontrol yalnızca bu anahtarla yapılır.
              </div>
            </div>

            <div style={sectionTitle}>Özet Ayarları</div>
            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Varsayılan Özet Motoru</label>
                <select style={selectStyle} value={settings.defaultEngine}
                  onChange={e => saveGeneralSettings({ ...settings, defaultEngine: e.target.value as SummaryEngine })}
                >
                  <option value="gemini-gem">Gemini Gem</option>
                  <option value="openai-compatible">API (DeepSeek / OpenAI)</option>
                  {localStatus?.isReady && <option value="chrome-local">Yerel AI</option>}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Varsayılan Özet Uzunluğu</label>
                <select style={selectStyle} value={settings.defaultLength}
                  onChange={e => saveGeneralSettings({ ...settings, defaultLength: e.target.value as any })}
                >
                  <option value="short">Kısa (3-5 cümle)</option>
                  <option value="standard">Standart</option>
                  <option value="detailed">Ayrıntılı</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Varsayılan Çıktı Dili</label>
                <select style={selectStyle} value={settings.defaultLanguage}
                  onChange={e => saveGeneralSettings({ ...settings, defaultLanguage: e.target.value as any })}
                >
                  <option value="tr">Türkçe</option>
                  <option value="en">İngilizce</option>
                  <option value="tr-en">Çift Dil (TR & EN)</option>
                </select>
              </div>
              <Toggle label="Zaman damgasına tıklanınca oynat" checked={settings.playTimestampOnClick}
                onChange={v => saveGeneralSettings({ ...settings, playTimestampOnClick: v })} />
            </div>
          </div>
        )}

        {/* ─── GEMINI GEM ────────────────── */}
        {activeTab === 'gemini-gem' && (
          <div>
            <div style={sectionTitle}>Gem URL</div>
            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px' }}>
              <input
                type="url"
                style={{ ...inputStyle, borderColor: gemUrlError ? '#ef4444' : 'var(--zy-border, #d1d5db)' }}
                value={gemSettings.gemUrl}
                onChange={e => {
                  const url = e.target.value;
                  setGemSettings(prev => ({ ...prev, gemUrl: url }));
                  validateGemUrl(url);
                }}
                onBlur={() => saveGem(gemSettings)}
                placeholder="https://gemini.google.com/gem/..."
              />
              {gemUrlError && <p style={{ color: '#ef4444', fontSize: '11px', marginTop: '4px' }}>{gemUrlError}</p>}
              {!gemUrlError && gemSettings.gemUrl && <p style={{ color: '#22c55e', fontSize: '11px', marginTop: '4px' }}>✓ URL geçerli</p>}
              <p style={{ color: '#9ca3af', fontSize: '11px', marginTop: '6px' }}>
                Gemini Gem paylaşım URL'sini yapıştırın. Örnek: https://gemini.google.com/gem/1yAw.../
              </p>
            </div>

            <div style={sectionTitle}>Çalışma Seçenekleri</div>
            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px' }}>
              <div style={{ height: '8px' }}></div>
              <Toggle label="Arka planda açmayı dene" checked={gemSettings.tryBackgroundTab} onChange={v => saveGem({ ...gemSettings, tryBackgroundTab: v })} />
              <Toggle label="Başarısızsa görünür sekmede aç" checked={gemSettings.fallbackToVisibleTab} onChange={v => saveGem({ ...gemSettings, fallbackToVisibleTab: v })} />
              <Toggle label="İşlem bitince otomatik kapat" checked={gemSettings.autoCloseTab} onChange={v => saveGem({ ...gemSettings, autoCloseTab: v })} />
              <Toggle label="Her videoda yeni sohbet başlat" checked={gemSettings.newChatPerVideo} onChange={v => saveGem({ ...gemSettings, newChatPerVideo: v })} />
              <Toggle label="Transkripti panoya da kopyala" checked={gemSettings.copyToClipboard} onChange={v => saveGem({ ...gemSettings, copyToClipboard: v })} />
              <Toggle label="Uzun transkriptte parçalara ayır" checked={gemSettings.chunkLongTranscripts} onChange={v => saveGem({ ...gemSettings, chunkLongTranscripts: v })} />
            </div>

            <div style={sectionTitle}>Durum</div>
            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px', fontSize: '13px' }}>
              {!gemSettings.gemUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f59e0b' }}>
                  <span>⚠</span> Gem URL ayarlanmadı
                </div>
              ) : gemUrlError ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
                  <span>✕</span> URL geçersiz
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#22c55e' }}>
                  <span>✓</span> Gem URL geçerli — kullanıma hazır
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── API ───────────────────────── */}
        {activeTab === 'api' && (
          <div>
            <div style={{ background: '#eff6ff', color: '#1e40af', padding: '10px 12px', borderRadius: '6px', fontSize: '11px', border: '1px solid #dbeafe', marginBottom: '12px' }}>
              DeepSeek, NVIDIA veya OpenAI uyumlu herhangi bir API servisi burada yapılandırılabilir. API anahtarı bu Chrome profilinin yerel eklenti depolamasında tutulur.
            </div>

            <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <button onClick={() => updateProvider('openai-compatible', { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'deepseek-ai/deepseek-v4-flash', maxTokens: 16384 })}
                  style={{
                    flex: 1, padding: '6px', background: '#ecfccb', border: '1px solid #bef264',
                    color: '#4d7c0f', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  }}
                >NVIDIA NIM Profili (DeepSeek)</button>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Base URL</label>
                <input type="url" style={inputStyle}
                  value={settings.providers['openai-compatible']?.baseUrl || ''}
                  onChange={e => updateProvider('openai-compatible', { baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>API Anahtarı</label>
                <input type="password" style={inputStyle}
                  value={settings.providers['openai-compatible']?.apiKey || ''}
                  onChange={e => updateProvider('openai-compatible', { apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Model</label>
                <input type="text" style={inputStyle}
                  value={settings.providers['openai-compatible']?.model || ''}
                  onChange={e => updateProvider('openai-compatible', { model: e.target.value })}
                />
              </div>
              <Toggle label="Yalnızca oturum boyunca sakla"
                checked={settings.providers['openai-compatible']?.isSessionStorage || false}
                onChange={v => updateProvider('openai-compatible', { isSessionStorage: v })}
              />
              <button onClick={() => testConnection('openai-compatible')}
                disabled={testStatus?.type === 'loading'}
                style={{
                  width: '100%', padding: '8px', background: 'var(--zy-item-bg, #f3f4f6)', border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: testStatus?.type === 'loading' ? 'wait' : 'pointer',
                  transition: 'background 0.15s', opacity: testStatus?.type === 'loading' ? 0.7 : 1
                }}
              >
                {testStatus?.type === 'loading' ? 'Test Ediliyor...' : 'Bağlantıyı Test Et'}
              </button>

              {testStatus && testStatus.type !== 'loading' && (
                <div style={{
                  marginTop: '8px', padding: '10px', borderRadius: '6px', fontSize: '12px',
                  backgroundColor: testStatus.type === 'success' ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${testStatus.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                  color: testStatus.type === 'success' ? '#166534' : '#991b1b'
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>{testStatus.message}</div>
                  {testStatus.latency !== undefined && <div><strong>Gecikme:</strong> {testStatus.latency}ms</div>}
                  {testStatus.limits && <div><strong>Limitler:</strong> {testStatus.limits}</div>}
                  {testStatus.aiResponse && <div style={{ marginTop: '4px', fontStyle: 'italic', opacity: 0.9 }}>AI Yanıtı: "{testStatus.aiResponse}"</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── YEREL AI ──────────────────── */}
        {activeTab === 'local' && (
          <div>
            <div style={sectionTitle}>Chrome Yerel AI Durumu</div>
            {localStatus ? (
              <div style={{ background: 'var(--zy-card-bg, #fff)', borderRadius: '8px', border: '1px solid #e5e7eb', padding: '12px', fontSize: '13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>Destekleniyor mu?</span>
                  <span style={{ fontWeight: 700, color: localStatus.isSupported ? '#22c55e' : '#ef4444' }}>
                    {localStatus.isSupported ? 'Evet' : 'Hayır'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <span>Kullanıma Hazır mı?</span>
                  <span style={{ fontWeight: 700, color: localStatus.isReady ? '#22c55e' : '#f59e0b' }}>
                    {localStatus.isReady ? 'Evet' : 'Hayır'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>İndirme Gerekiyor mu?</span>
                  <span style={{ fontWeight: 700, color: localStatus.needsDownload ? '#f59e0b' : 'var(--zy-text-muted, #6b7280)' }}>
                    {localStatus.needsDownload ? 'Evet' : 'Hayır'}
                  </span>
                </div>
              </div>
            ) : (
              <p style={{ color: '#9ca3af', fontSize: '13px', fontStyle: 'italic' }}>Kontrol ediliyor...</p>
            )}

            {!localStatus?.isSupported && (
              <div style={{ background: 'var(--zy-error-bg, #fef2f2)', color: 'var(--zy-error-text, #dc2626)', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', border: '1px solid #fecaca', marginTop: '12px' }}>
                Bu cihazda Chrome Yerel AI kullanılamıyor. Lütfen Chrome'un deneysel AI özelliklerini etkinleştirdiğinizden emin olun.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fixed footer */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid #e5e7eb',
        backgroundColor: 'var(--zy-card-bg, #fff)', flexShrink: 0,
        fontSize: '11px', color: '#9ca3af', textAlign: 'center',
      }}>
        ZYouTube v1.0.0
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
