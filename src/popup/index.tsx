import { filterLibraryEntries } from './filter-helpers';
import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import '../styles/popup.css';
import { AISettingsService } from '../settings/ai-settings';
import { ExtensionSettings, DEFAULT_SETTINGS, AIProviderConfig, AIProviderId } from '../settings/types';
import { GemSettingsService } from '../gem/settings';
import { GemSettings, DEFAULT_GEM_SETTINGS, PanelSettings, DEFAULT_PANEL_SETTINGS, SummaryEngine } from '../gem/types';
import { ConfigValidator } from '../settings/validation';
import { LocalAIChecker, LocalAIStatus } from '../settings/local-ai';
import { LibraryService, VideoLibraryEntry } from '../history/library-service';

import { PromptBuilder } from '../ai/prompt-builder';
import { SummaryRequest } from '../ai/types';
import { CorrectionPromptBuilder } from '../ai/prompt-correction';
import { getPopupRoot } from './popup-root';

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
  const [activeTab, setActiveTab] = useState<'general' | 'gemini-gem' | 'api' | 'local' | 'history'>('general');
  const [localStatus, setLocalStatus] = useState<LocalAIStatus | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [gemUrlError, setGemUrlError] = useState<string>('');
  const [libraryEntries, setLibraryEntries] = useState<VideoLibraryEntry[]>([]);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('latest');
  const [draftProvider, setDraftProvider] = useState<AIProviderConfig | null>(null);

  const loadLibrary = async () => {
    setIsLibraryLoading(true);
    setLibraryError(null);
    try {
      const entries = await LibraryService.getEntries();
      setLibraryEntries(entries);
    } catch (err: unknown) {
      setLibraryError(err instanceof Error ? err.message : 'Bilinmeyen hata oluştu');
    } finally {
      setIsLibraryLoading(false);
    }
  };

  useEffect(() => {
    AISettingsService.getSettings().then(s => {
      setSettings(s);
      setDraftProvider(s.providers['openai-compatible'] || null);
    });
    GemSettingsService.getGemSettings().then(g => setGemSettings(g));
    GemSettingsService.getPanelSettings().then(p => setPanelSettings(p));
    LocalAIChecker.checkStatus().then(st => setLocalStatus(st));
    
    loadLibrary();

    // Migration
    GemSettingsService.migrateFromGeminiApi();

    // Listen for live updates
    const handleMessage = (msg: unknown) => {
      const message = msg as any;
      if (message && message.type === 'LIBRARY_ENTRY_UPDATED') {
        loadLibrary();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
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

  const updateProviderDraft = (updates: Partial<AIProviderConfig>) => {
    setDraftProvider(prev => {
      if (!prev) return { id: 'openai-compatible', ...updates };
      return { ...prev, ...updates };
    });
  };

  const requestPermissionAndSave = async (provider: AIProviderConfig): Promise<boolean> => {
    if (provider.baseUrl) {
      try {
        const url = new URL(provider.baseUrl);
        const origin = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/*`;
        if (chrome.permissions?.request && chrome.permissions?.contains) {
          const hasPerm = await new Promise<boolean>(resolve => {
            chrome.permissions.contains({ origins: [origin] }, resolve);
          });
          if (!hasPerm) {
            const granted = await new Promise<boolean>(resolve => {
              chrome.permissions.request({ origins: [origin] }, resolve);
            });
            if (!granted) {
              setTestStatus({ type: 'error', message: `İzin reddedildi: ${origin}` });
              return false;
            }
          }
        }
      } catch {
        setTestStatus({ type: 'error', message: 'Geçersiz Base URL' });
        return false;
      }
    }
    
    const newProviders = { ...settings.providers };
    newProviders[provider.id] = provider;
    await saveGeneralSettings({ ...settings, providers: newProviders });
    return true;
  };

  const [testStatus, setTestStatus] = useState<{type: 'loading'|'success'|'error', message: string, latency?: number, limits?: string, aiResponse?: string} | null>(null);
  
  const [showPreview, setShowPreview] = useState(false);
  const [previewTab, setPreviewTab] = useState<'json'|'prompt'>('json');
  const [previewRequestType, setPreviewRequestType] = useState<'summary'|'correction'>('summary');

  const testConnection = async (id: AIProviderId) => {
    const config = draftProvider || settings.providers[id];
    const validation = ConfigValidator.validate(config || {});
    if (!validation.isValid) {
      setTestStatus({ type: 'error', message: 'Geçersiz Ayarlar:\n' + validation.errors.join('\n') });
      return;
    }
    
    const saved = await requestPermissionAndSave(config!);
    if (!saved) return;
    
    setTestStatus({ type: 'loading', message: 'Bağlantı test ediliyor, lütfen bekleyin...' });
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
    { id: 'history', label: 'Özet Listesi' },
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
              <Toggle label="Native YouTube Transkriptini Gizle" checked={panelSettings.hideNativeTranscript} onChange={v => {
                const newSettings = { ...panelSettings, hideNativeTranscript: v };
                GemSettingsService.savePanelSettings(newSettings);
                setPanelSettings(newSettings);
                showSaved();
              }} />
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                Panel, YouTube watch sayfalarında otomatik olarak görünür. DOM'dan veri alınırken native panel açık bırakılmaz, gizlenir.
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
              <div style={{ marginTop: '10px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Gemini yanıt zaman aşımı (ms)</label>
                <input type="number" style={inputStyle}
                  value={gemSettings.responseTimeoutMs ?? 600000}
                  onChange={e => {
                    const val = parseInt(e.target.value);
                    if (isNaN(val)) {
                      saveGem({ ...gemSettings, responseTimeoutMs: 600000 });
                    } else {
                      saveGem({ ...gemSettings, responseTimeoutMs: Math.min(1800000, Math.max(120000, val)) });
                    }
                  }}
                  min={120000}
                  max={1800000}
                  placeholder="600000"
                />
                <p style={{ color: '#9ca3af', fontSize: '11px', marginTop: '4px' }}>Varsayılan 10 dakika (600000). Geçerli aralık 120000–1800000.</p>
              </div>
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
                <button onClick={() => updateProviderDraft({ baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'deepseek-ai/deepseek-v4-flash', maxTokens: 16384, contextWindowTokens: 130000 })}
                  style={{
                    flex: 1, padding: '6px', background: '#ecfccb', border: '1px solid #bef264',
                    color: '#4d7c0f', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  }}
                >NVIDIA NIM Profili (DeepSeek)</button>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Base URL</label>
                <input type="url" style={inputStyle}
                  value={draftProvider?.baseUrl || ''}
                  onChange={e => updateProviderDraft({ baseUrl: e.target.value })}
                  placeholder="https://api.deepseek.com/v1"
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>API Anahtarı</label>
                <input type="password" style={inputStyle}
                  value={draftProvider?.apiKey || ''}
                  onChange={e => updateProviderDraft({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Model</label>
                  <input type="text" style={inputStyle}
                    value={draftProvider?.model || ''}
                    onChange={e => updateProviderDraft({ model: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Format</label>
                  <select style={selectStyle}
                    value={draftProvider?.responseMode || 'markdown'}
                    onChange={e => updateProviderDraft({ responseMode: e.target.value as any })}
                  >
                    <option value="markdown">Markdown</option>
                    <option value="json">JSON Object</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Model bağlam limiti</label>
                  <input type="number" style={inputStyle}
                    value={draftProvider?.contextWindowTokens ?? 130000}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      updateProviderDraft({ contextWindowTokens: (isNaN(val) || val < 4000) ? 130000 : val });
                    }}
                    placeholder="130000"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Düzeltme çıktı token limiti</label>
                  <input type="number" style={inputStyle}
                    value={draftProvider?.correctionMaxTokens ?? 130000}
                    onChange={e => {
                      const val = parseInt(e.target.value);
                      if (isNaN(val)) {
                        updateProviderDraft({ correctionMaxTokens: 130000 });
                      } else {
                        updateProviderDraft({ correctionMaxTokens: Math.min(1000000, Math.max(1000, val)) });
                      }
                    }}
                    min={1000}
                    max={1000000}
                    placeholder="130000"
                  />
                </div>
              </div>
              <Toggle label="Yalnızca oturum boyunca sakla"
                checked={draftProvider?.isSessionStorage || false}
                onChange={v => updateProviderDraft({ isSessionStorage: v })}
              />
              <Toggle label="Akıl Yürütme (Reasoning) Aktif"
                checked={draftProvider?.enableReasoning || false}
                onChange={v => updateProviderDraft({ enableReasoning: v })}
              />
              <Toggle label="Düzeltmede JSON Response Format (Önerilen)"
                checked={draftProvider?.correctionJsonMode !== false}
                onChange={v => updateProviderDraft({ correctionJsonMode: v })}
              />
              
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button onClick={() => {
                  if (draftProvider) requestPermissionAndSave(draftProvider);
                }}
                  style={{
                    flex: 1, padding: '8px', background: '#3b82f6', color: '#fff', border: 'none',
                    borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    transition: 'background 0.15s'
                  }}
                >
                  Kaydet
                </button>
                <button onClick={() => testConnection('openai-compatible')}
                  disabled={testStatus?.type === 'loading'}
                  style={{
                    flex: 1, padding: '8px', background: 'var(--zy-item-bg, #f3f4f6)', border: '1px solid #d1d5db',
                    borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: testStatus?.type === 'loading' ? 'wait' : 'pointer',
                    transition: 'background 0.15s', opacity: testStatus?.type === 'loading' ? 0.7 : 1
                  }}
                >
                  {testStatus?.type === 'loading' ? 'Test Ediliyor...' : 'Bağlantıyı Test Et'}
                </button>
              </div>

              <div style={{ marginTop: '8px' }}>
                <button onClick={() => setShowPreview(!showPreview)}
                  style={{ width: '100%', padding: '6px', background: 'transparent', border: '1px dashed #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#6b7280' }}
                >
                  {showPreview ? 'Gönderilecek İstek Önizlemesini Gizle' : 'Gönderilecek İstek Önizlemesini Göster'}
                </button>
              </div>
              
              {showPreview && (() => {
                 let requestBody: any;
                 if (previewRequestType === 'summary') {
                   const mockRequest: SummaryRequest = {
                     taskId: 'preview_1',
                     video: { videoId: 'abc', title: 'Test Video', url: 'https://youtube.com/watch?v=abc' },
                     transcript: { languageCode: 'tr', sourceType: 'manual', qualityLevel: 'high', qualityReasons: [], segments: [{ id: 's1', sequence: 1, startTimeMs: 0, endTimeMs: 5000, durationMs: 5000, text: 'Test içeriği', cleanText: 'Test içeriği', languageCode: 'tr' }] },
                     options: { length: settings.defaultLength, outputLanguage: settings.defaultLanguage, includeKeyIdeas: true, includeSections: true, includeActionItems: true },
                     engine: 'openai-compatible'
                   };
                   requestBody = PromptBuilder.buildApiRequestBody(mockRequest, draftProvider || settings.providers['openai-compatible']);
                 } else {
                   const mockCorrectionRequest: any = {
                     taskId: 'preview_2',
                     video: { videoId: 'abc', title: 'Test Video' },
                     transcript: {
                       sourceLanguage: 'en',
                       segments: [{
                         id: 'segment-1',
                         startTimeMs: 0,
                         endTimeMs: 3000,
                         turkish: 'Bu örnek bir cümledir.',
                         english: 'This is an example sentence.'
                       }]
                     }
                   };
                   requestBody = CorrectionPromptBuilder.buildApiRequestBody(mockCorrectionRequest, draftProvider || settings.providers['openai-compatible']);
                 }
                 
                 const displayBody = { ...requestBody };
                 
                 return (
                   <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ padding: '8px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '8px', alignItems: 'center' }}>
                         <span style={{ fontSize: '11px', fontWeight: 600 }}>İstek Türü:</span>
                         <select 
                           style={{ ...selectStyle, padding: '4px', height: 'auto', flex: 1 }}
                           value={previewRequestType}
                           onChange={e => setPreviewRequestType(e.target.value as any)}
                         >
                           <option value="summary">Özet İsteği</option>
                           <option value="correction">Transkript Düzeltme İsteği</option>
                         </select>
                      </div>
                      <div style={{ display: 'flex', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                        <button onClick={() => setPreviewTab('json')} style={{ flex: 1, padding: '6px', background: previewTab === 'json' ? '#fff' : 'transparent', border: 'none', borderBottom: previewTab === 'json' ? '2px solid #3b82f6' : '2px solid transparent', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>JSON Gövdesi</button>
                        <button onClick={() => setPreviewTab('prompt')} style={{ flex: 1, padding: '6px', background: previewTab === 'prompt' ? '#fff' : 'transparent', border: 'none', borderBottom: previewTab === 'prompt' ? '2px solid #3b82f6' : '2px solid transparent', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Prompt (Sistem & Kullanıcı)</button>
                      </div>
                      <div style={{ padding: '8px', fontSize: '10px', fontFamily: 'monospace', maxHeight: '150px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {previewTab === 'json' ? (
                          JSON.stringify(displayBody, null, 2)
                        ) : (
                          <>
                            <strong>[Sistem]</strong><br/>{displayBody?.messages?.[0]?.content}<br/><br/>
                            <strong>[Kullanıcı]</strong><br/>{displayBody?.messages?.[1]?.content}
                          </>
                        )}
                      </div>
                   </div>
                 );
              })()}

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
              
              <div style={{ marginTop: '12px', padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>
                API özetleri tek istekte gönderilir. Uzun transkriptler segment sınırında kısaltılır.
              </div>
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

        {/* History / Özet Listesi Tab */}
        {activeTab === 'history' && (() => {
          
          let filtered = filterLibraryEntries(libraryEntries, searchQuery, typeFilter, sortOrder);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>Özet ve Transkript Geçmişi</h2>
                <button 
                  onClick={() => {
                    if(confirm('Tüm geçmişi silmek istediğinize emin misiniz?')) {
                      LibraryService.clearAll().then(() => setLibraryEntries([]));
                    }
                  }}
                  style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  Tümünü Sil
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <input 
                  type="text" 
                  placeholder="Başlık, transkript, özet veya kelime ara..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{...inputStyle, padding: '8px', fontSize: '12px'}}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select style={{...selectStyle, flex: 1, padding: '4px', fontSize: '12px'}} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                    <option value="all">Tümü</option>
                    <option value="summary">Özeti Olanlar</option>
                    <option value="correction">Düzeltilmiş Transkript</option>
                    <option value="words">Çalışılacak Kelime</option>
                    <option value="transcript">Yalnızca Transkript</option>
                  </select>
                  <select style={{...selectStyle, flex: 1, padding: '4px', fontSize: '12px'}} value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
                    <option value="latest">Son Güncellenen</option>
                    <option value="oldest">En Eski</option>
                    <option value="az">Başlık A-Z</option>
                    <option value="za">Başlık Z-A</option>
                  </select>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--zy-text-muted, #6b7280)', textAlign: 'right' }}>
                  {filtered.length} kayıt bulundu
                </div>
              </div>
              
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {libraryError && (
                  <div style={{ padding: '12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '12px', textAlign: 'center' }}>
                    <div style={{ marginBottom: '8px' }}>Liste yüklenirken bir hata oluştu: {libraryError}</div>
                    <button onClick={loadLibrary} style={{ padding: '6px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Tekrar Dene</button>
                  </div>
                )}
                
                {!libraryError && isLibraryLoading && libraryEntries.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>Yükleniyor...</div>
                ) : !libraryError && filtered.length === 0 ? (
                  <div style={{ color: '#9ca3af', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
                    {libraryEntries.length === 0 ? "Kayıt bulunamadı." : "Aramanızla eşleşen kayıt bulunamadı."}
                  </div>
                ) : !libraryError && (
                  filtered.map(s => (
                    <div key={s.videoId} style={{ display: 'flex', gap: '10px', padding: '10px', background: 'var(--zy-item-bg, #f3f4f6)', borderRadius: '6px', cursor: 'pointer', transition: 'background 0.2s', border: '1px solid var(--zy-border, #e5e7eb)' }}
                      onClick={(e) => {
                         if ((e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'svg' && (e.target as HTMLElement).tagName !== 'path') {
                           chrome.tabs.create({ url: chrome.runtime.getURL(`history.html?videoId=${s.videoId}`) });
                         }
                      }}
                      onMouseOver={(e) => e.currentTarget.style.background = 'var(--zy-item-hover, #e5e7eb)'}
                      onMouseOut={(e) => e.currentTarget.style.background = 'var(--zy-item-bg, #f3f4f6)'}
                    >
                      <img src={`https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`} 
                           style={{ width: '80px', height: '45px', objectFit: 'cover', borderRadius: '4px', backgroundColor: '#e5e7eb' }} 
                           onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {s.title}
                        </div>
                        
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {s.hasSummary && <span style={{ fontSize: '10px', padding: '2px 4px', background: '#dbeafe', color: '#1e40af', borderRadius: '4px' }}>Özet</span>}
                          {s.hasCorrectedTranscript && <span style={{ fontSize: '10px', padding: '2px 4px', background: '#dcfce3', color: '#166534', borderRadius: '4px' }}>Düzeltilmiş ({s.correctedTranscript?.sentences?.length || 0})</span>}
                          {s.hasOriginalTranscript && !s.hasCorrectedTranscript && <span style={{ fontSize: '10px', padding: '2px 4px', background: '#f3f4f6', color: '#374151', borderRadius: '4px' }}>Transkript</span>}
                          {s.studyWordCount > 0 && <span style={{ fontSize: '10px', padding: '2px 4px', background: '#fef3c7', color: '#92400e', borderRadius: '4px' }}>{s.studyWordCount} Kelime</span>}
                        </div>

                        {!s.hasSummary && s.hasCorrectedTranscript && (
                          <div style={{ fontSize: '10px', color: '#ef4444', fontStyle: 'italic' }}>Özet oluşturulmamış</div>
                        )}
                        
                        <div style={{ fontSize: '11px', color: 'var(--zy-text-muted, #6b7280)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                          <span>{new Date(s.updatedAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute:'2-digit' })}</span>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Bu kaydı silmek istediğinize emin misiniz?')) {
                                LibraryService.deleteVideoEntry(s.videoId).then(() => {
                                  setLibraryEntries(prev => prev.filter(x => x.videoId !== s.videoId));
                                }).catch(console.error);
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                            title="Sil"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

const container = getPopupRoot(document);
const root = createRoot(container);
root.render(<Popup />);
