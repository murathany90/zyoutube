import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import '../index.css';
import { AISettingsService } from '../settings/ai-settings';
import { ExtensionSettings, DEFAULT_SETTINGS, AIProviderConfig } from '../settings/types';
import { ConfigValidator } from '../settings/validation';
import { AIProviderId } from '../ai/types';
import { LocalAIChecker, LocalAIStatus } from '../settings/local-ai';

const Popup = () => {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [activeTab, setActiveTab] = useState<'general' | 'gemini' | 'openai' | 'local'>('general');
  const [localStatus, setLocalStatus] = useState<LocalAIStatus | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');

  useEffect(() => {
    AISettingsService.getSettings().then(s => setSettings(s));
    LocalAIChecker.checkStatus().then(st => setLocalStatus(st));
  }, []);

  const saveSettings = async (newSettings: ExtensionSettings) => {
    await AISettingsService.saveSettings(newSettings);
    setSettings(newSettings);
    setSaveStatus('Ayarlar kaydedildi');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const updateGeneral = (updates: Partial<ExtensionSettings>) => {
    saveSettings({ ...settings, ...updates });
  };

  const updateProvider = async (id: AIProviderId, updates: Partial<AIProviderConfig>) => {
    // URL değiştiyse izin iste (sadece openai-compatible için)
    if (id === 'openai-compatible' && updates.baseUrl) {
      try {
        const url = new URL(updates.baseUrl);
        const origin = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/*`;
        if (chrome.permissions && chrome.permissions.request) {
          const granted = await new Promise(resolve => {
            chrome.permissions.request({ origins: [origin] }, (granted) => resolve(granted));
          });
          if (!granted) {
             alert('Bağlantı için izin verilmedi. İstekler başarısız olabilir.');
          }
        }
      } catch (e) {
        // Invalid URL, let validation handle it later
      }
    }

    const newProviders = { ...settings.providers };
    newProviders[id] = { ...newProviders[id], ...updates };
    saveSettings({ ...settings, providers: newProviders });
  };

  const testConnection = async (id: AIProviderId) => {
     const config = settings.providers[id];
     const validation = ConfigValidator.validate(config);
     if (!validation.isValid) {
       alert('Geçersiz Ayarlar:\n' + validation.errors.join('\n'));
     } else {
       alert('Ayarlar geçerli. (Bağlantı testi henüz uygulanmadı)');
     }
  };

  const openPanel = async () => {
    const tabs = await chrome.tabs.query({});
    const ytTab = tabs.find(t => t.url?.includes('youtube.com/watch') || t.url?.includes('localhost:3000'));
    if (ytTab && ytTab.id) {
      chrome.tabs.sendMessage(ytTab.id, { type: 'OPEN_PANEL' });
    }
  };

  return (
    <div className="w-96 min-h-[400px] flex flex-col bg-gray-50 text-gray-900">
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21.583 6.846c-.204-1.396-1.145-2.52-2.368-2.736C17.119 3.75 12 3.75 12 3.75s-5.12 0-7.215.36c-1.223.216-2.164 1.34-2.368 2.736C2 8.71 2 12 2 12s0 3.29.417 5.154c.204 1.396 1.145 2.52 2.368 2.736 2.095.36 7.215.36 7.215.36s5.12 0 7.215-.36c1.223-.216 2.164-1.34 2.368-2.736.417-1.864.417-5.154.417-5.154s0-3.29-.417-5.154zM9.996 15.596V8.404L15.811 12l-5.815 3.596z" />
          </svg>
          AI Özet Ayarları
        </h1>
        <button onClick={openPanel} className="text-xs bg-red-600 text-white px-2 py-1 rounded shadow-sm hover:bg-red-700">
          Panel'i Aç
        </button>
      </header>

      <div className="flex border-b text-sm font-medium bg-white">
        <button onClick={() => setActiveTab('general')} className={`flex-1 py-2 ${activeTab === 'general' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-600 hover:bg-gray-50'}`}>Genel</button>
        <button onClick={() => setActiveTab('gemini')} className={`flex-1 py-2 ${activeTab === 'gemini' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-600 hover:bg-gray-50'}`}>Gemini</button>
        <button onClick={() => setActiveTab('openai')} className={`flex-1 py-2 ${activeTab === 'openai' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-600 hover:bg-gray-50'}`}>OpenAI</button>
        <button onClick={() => setActiveTab('local')} className={`flex-1 py-2 ${activeTab === 'local' ? 'border-b-2 border-red-600 text-red-600' : 'text-gray-600 hover:bg-gray-50'}`}>Yerel AI</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
        
        {/* GENERAL TAB */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Varsayılan Sağlayıcı</label>
              <select 
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.defaultProviderId}
                onChange={e => updateGeneral({ defaultProviderId: e.target.value as AIProviderId })}
              >
                <option value="gemini-api">Gemini API</option>
                <option value="openai-compatible">OpenAI Uyumlu</option>
                <option value="chrome-local">Chrome Yerel AI</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Varsayılan Özet Uzunluğu</label>
              <select 
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.defaultLength}
                onChange={e => updateGeneral({ defaultLength: e.target.value as any })}
              >
                <option value="short">Kısa (3-5 cümle)</option>
                <option value="standard">Standart</option>
                <option value="detailed">Ayrıntılı</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Varsayılan Çıktı Dili</label>
              <select 
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.defaultLanguage}
                onChange={e => updateGeneral({ defaultLanguage: e.target.value as any })}
              >
                <option value="tr">Türkçe</option>
                <option value="en">İngilizce</option>
                <option value="tr-en">Çift Dil (TR & EN)</option>
              </select>
            </div>
            <label className="flex items-center space-x-2 text-sm cursor-pointer group">
              <input 
                type="checkbox" 
                checked={settings.playTimestampOnClick}
                onChange={e => updateGeneral({ playTimestampOnClick: e.target.checked })}
                className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
              />
              <span className="group-hover:text-red-700 transition">Zaman damgasına tıklanınca oynat</span>
            </label>
          </div>
        )}

        {/* GEMINI TAB */}
        {activeTab === 'gemini' && (
          <div className="space-y-4">
            <div className="bg-blue-50 text-blue-800 p-3 rounded text-xs border border-blue-100">
              Kalıcı olarak saklanan API anahtarı bu Chrome profilinin yerel eklenti depolamasında tutulur. Bu alan özel bir parola kasası değildir.
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">API Anahtarı</label>
              <input 
                type="password"
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.providers['gemini-api']?.apiKey || ''}
                onChange={e => updateProvider('gemini-api', { apiKey: e.target.value })}
                placeholder="AIzaSy..."
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Model</label>
              <input 
                type="text"
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.providers['gemini-api']?.model || ''}
                onChange={e => updateProvider('gemini-api', { model: e.target.value })}
              />
            </div>
            <label className="flex items-center space-x-2 text-sm cursor-pointer group">
              <input 
                type="checkbox" 
                checked={settings.providers['gemini-api']?.isSessionStorage || false}
                onChange={e => updateProvider('gemini-api', { isSessionStorage: e.target.checked })}
                className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
              />
              <span className="group-hover:text-red-700 transition">Yalnızca oturum boyunca sakla</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => testConnection('gemini-api')} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded text-sm transition">Test Et</button>
            </div>
          </div>
        )}

        {/* OPENAI TAB */}
        {activeTab === 'openai' && (
          <div className="space-y-4">
            <div className="bg-blue-50 text-blue-800 p-3 rounded text-xs border border-blue-100">
              Kalıcı olarak saklanan API anahtarı bu Chrome profilinin yerel eklenti depolamasında tutulur. Bu alan özel bir parola kasası değildir.
            </div>
            
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Base URL</label>
              <input 
                type="url"
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.providers['openai-compatible']?.baseUrl || ''}
                onChange={e => updateProvider('openai-compatible', { baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">API Anahtarı</label>
              <input 
                type="password"
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.providers['openai-compatible']?.apiKey || ''}
                onChange={e => updateProvider('openai-compatible', { apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Model</label>
              <input 
                type="text"
                className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-red-200 focus:border-red-500 outline-none transition"
                value={settings.providers['openai-compatible']?.model || ''}
                onChange={e => updateProvider('openai-compatible', { model: e.target.value })}
              />
            </div>
            <label className="flex items-center space-x-2 text-sm cursor-pointer group">
              <input 
                type="checkbox" 
                checked={settings.providers['openai-compatible']?.isSessionStorage || false}
                onChange={e => updateProvider('openai-compatible', { isSessionStorage: e.target.checked })}
                className="rounded text-red-600 focus:ring-red-500 w-4 h-4 cursor-pointer"
              />
              <span className="group-hover:text-red-700 transition">Yalnızca oturum boyunca sakla</span>
            </label>
            <div className="flex gap-2 pt-2">
              <button onClick={() => testConnection('openai-compatible')} className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 rounded text-sm transition">Test Et</button>
            </div>
          </div>
        )}

        {/* LOCAL AI TAB */}
        {activeTab === 'local' && (
          <div className="space-y-4">
            <h3 className="font-bold text-gray-800 text-lg">Chrome Yerel AI Durumu</h3>
            {localStatus ? (
              <ul className="space-y-2 text-sm text-gray-700 bg-white p-4 rounded border shadow-sm">
                <li className="flex justify-between border-b pb-2">
                  <span>Destekleniyor mu?</span>
                  <span className={localStatus.isSupported ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                    {localStatus.isSupported ? 'Evet' : 'Hayır'}
                  </span>
                </li>
                <li className="flex justify-between border-b pb-2 pt-1">
                  <span>Kullanıma Hazır mı?</span>
                  <span className={localStatus.isReady ? 'text-green-600 font-bold' : 'text-yellow-600 font-bold'}>
                    {localStatus.isReady ? 'Evet' : 'Hayır'}
                  </span>
                </li>
                <li className="flex justify-between pt-1">
                  <span>İndirme Gerekiyor mu?</span>
                  <span className={localStatus.needsDownload ? 'text-orange-600 font-bold' : 'text-gray-600 font-bold'}>
                    {localStatus.needsDownload ? 'Evet' : 'Hayır'}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="text-gray-500 text-sm italic">Kontrol ediliyor...</p>
            )}
            
            {!localStatus?.isSupported && (
              <p className="text-red-600 text-sm p-3 bg-red-50 rounded border border-red-100 mt-4">
                Bu cihazda Chrome Yerel AI kullanılamıyor. Lütfen Chrome'un deneysel AI özelliklerini etkinleştirdiğinizden emin olun.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="p-3 border-t bg-white flex justify-between items-center text-sm shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <span className="text-green-600 font-medium">{saveStatus}</span>
        {/* We auto-save on change anyway, but keeping a placeholder for explicit save if needed */}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
