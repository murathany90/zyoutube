import { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import '../index.css';
import { TranscriptTab } from './TranscriptTab';
import { SummaryTab } from './components/SummaryTab';
import { GemSettingsService } from '../gem/settings';
import { PanelSettings } from '../gem/types';

type PanelTab = 'summary' | 'transcript' | 'keyideas' | 'ask' | 'learn';

const Panel = ({ videoId, onClose }: { videoId: string; onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('summary');
  const title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || 'Bilinmeyen Video';
  const url = window.location.href;

  // Video değişiminde state sıfırla
  useEffect(() => {
    setActiveTab('summary');
  }, [videoId]);

  const tabs: { id: PanelTab; label: string; enabled: boolean }[] = [
    { id: 'summary', label: 'Özet', enabled: true },
    { id: 'transcript', label: 'Transkript', enabled: true },
    { id: 'keyideas', label: 'Ana Fikirler', enabled: false },
    { id: 'ask', label: 'Sor', enabled: false },
    { id: 'learn', label: 'Öğren', enabled: false },
  ];

  return (
    <div className="zyoutube-panel" style={{
      width: '100%',
      height: 'var(--zy-panel-height, 500px)',
      minHeight: '420px',
      maxHeight: 'calc(100vh - 90px)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '12px',
      border: '1px solid var(--zy-border, #e5e7eb)',
      backgroundColor: 'var(--zy-bg, #f9fafb)',
      color: 'var(--zy-text, #111827)',
      marginBottom: '16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}>
      {/* Fixed header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid var(--zy-border, #e5e7eb)',
        backgroundColor: 'var(--zy-header-bg, #ffffff)',
        borderRadius: '12px 12px 0 0',
        flexShrink: 0,
      }}>
        <h2 style={{ fontSize: '14px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ef4444' }}>
            <path d="M12 2L9.19 8.63L2 9.24L7.65 13.97L5.82 21L12 17.27L18.18 21L16.35 13.97L22 9.24L14.81 8.63L12 2Z" />
          </svg>
          ZYouTube AI
        </h2>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#9ca3af', fontSize: '16px' }}
          title="Paneli Gizle"
        >✕</button>
      </div>

      {/* Fixed tabs */}
      <div style={{
        display: 'flex',
        gap: '0',
        borderBottom: '1px solid var(--zy-border, #e5e7eb)',
        backgroundColor: 'var(--zy-header-bg, #ffffff)',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => t.enabled && setActiveTab(t.id)}
            disabled={!t.enabled}
            style={{
              flex: '1 0 auto',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid #ef4444' : '2px solid transparent',
              color: !t.enabled ? 'var(--zy-border, #d1d5db)' : activeTab === t.id ? '#ef4444' : 'var(--zy-text-muted, #6b7280)',
              cursor: t.enabled ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="zyoutube-panel-content" style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '12px',
      }}>
        {activeTab === 'summary' && <SummaryTab videoId={videoId} title={title} url={url} />}
        {activeTab === 'transcript' && <TranscriptTab videoId={videoId} />}
        {activeTab === 'keyideas' && <div style={{ color: '#9ca3af', fontSize: '13px', padding: '20px', textAlign: 'center' }}>Yakında...</div>}
        {activeTab === 'ask' && <div style={{ color: '#9ca3af', fontSize: '13px', padding: '20px', textAlign: 'center' }}>Yakında...</div>}
        {activeTab === 'learn' && <div style={{ color: '#9ca3af', fontSize: '13px', padding: '20px', textAlign: 'center' }}>Yakında...</div>}
      </div>
    </div>
  );
};

// ─── Mount/unmount yönetimi ───────────────────────────

let panelRoot: Root | null = null;
let currentVideoId = '';
let panelHiddenForTab = false;

function getVideoId(): string | null {
  if (window.location.href.includes('youtube.com/watch')) {
    return new URLSearchParams(window.location.search).get('v');
  }
  if (window.location.href.includes('localhost:3000')) {
    return new URLSearchParams(window.location.search).get('v') || 'dQw4w9WgXcQ';
  }
  return null;
}

function findSecondary(): HTMLElement | null {
  return document.querySelector('#secondary-inner') || document.querySelector('#secondary');
}

function getPlayerHeight(): number {
  const player = document.querySelector('#player-container-outer, #movie_player, .html5-video-player') as HTMLElement;
  if (player) {
    const rect = player.getBoundingClientRect();
    if (rect.height > 200) return Math.round(rect.height);
  }
  return 500;
}

function applyTheme() {
  const isDark = document.documentElement.getAttribute('dark') !== null ||
    document.querySelector('html[dark]') !== null ||
    getComputedStyle(document.body).backgroundColor.includes('rgb(15') ||
    getComputedStyle(document.body).backgroundColor.includes('rgb(32');

  const container = document.getElementById('zyoutube-panel-container');
  if (container) {
    const newBg = isDark ? '#1f1f1f' : '#f9fafb';
    if (container.style.getPropertyValue('--zy-bg') !== newBg) {
      container.style.setProperty('--zy-bg', newBg);
      container.style.setProperty('--zy-card-bg', isDark ? '#2a2a2a' : '#ffffff');
      container.style.setProperty('--zy-header-bg', isDark ? '#282828' : '#ffffff');
      container.style.setProperty('--zy-text', isDark ? '#e5e7eb' : '#111827');
      container.style.setProperty('--zy-text-muted', isDark ? '#9ca3af' : '#4b5563');
      container.style.setProperty('--zy-border', isDark ? '#3f3f46' : '#e5e7eb');
      
      // Additional variables for items and errors
      container.style.setProperty('--zy-item-bg', isDark ? '#3f3f46' : '#f3f4f6');
      container.style.setProperty('--zy-item-hover', isDark ? '#52525b' : '#e5e7eb');
      container.style.setProperty('--zy-error-bg', isDark ? '#7f1d1d' : '#fef2f2');
      container.style.setProperty('--zy-error-border', isDark ? '#991b1b' : '#fecaca');
      container.style.setProperty('--zy-error-text', isDark ? '#fca5a5' : '#dc2626');
      container.style.setProperty('--zy-card-inner', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)');
    }
  }
}

function mountPanel(videoId: string) {
  const secondary = findSecondary();
  if (!secondary) return false;

  // Çift panel önleme
  if (document.getElementById('zyoutube-panel-container')) {
    // Video değiştiyse güncelle
    if (videoId !== currentVideoId) {
      currentVideoId = videoId;
      renderPanel(videoId);
    }
    return true;
  }

  const container = document.createElement('div');
  container.id = 'zyoutube-panel-container';
  container.style.setProperty('--zy-panel-height', getPlayerHeight() + 'px');

  // Önerilen videoların önüne ekle (#secondary-inner veya #secondary'nin ilk çocuğu)
  secondary.insertBefore(container, secondary.firstChild);

  applyTheme();

  panelRoot = createRoot(container);
  currentVideoId = videoId;
  panelHiddenForTab = false;
  renderPanel(videoId);

  return true;
}

function renderPanel(videoId: string) {
  if (!panelRoot) return;
  panelRoot.render(
    <Panel
      videoId={videoId}
      onClose={() => {
        panelHiddenForTab = true;
        unmountPanel();
      }}
    />
  );
}

function unmountPanel() {
  const container = document.getElementById('zyoutube-panel-container');
  if (container) {
    if (panelRoot) {
      panelRoot.unmount();
      panelRoot = null;
    }
    container.remove();
  }
}

// ─── AI Özet düğmesi ────────────────────────────

function injectButton() {
  const actionsRow = document.querySelector('#top-level-buttons-computed');
  if (!actionsRow) {
    console.log('injectButton: #top-level-buttons-computed NOT FOUND');
    return false;
  }
  if (document.getElementById('ai-summary-btn')) {
    console.log('injectButton: already exists');
    return true;
  }
  console.log('injectButton: INJECTING BUTTON');

  const btn = document.createElement('button');
  btn.id = 'ai-summary-btn';
  btn.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading';
  btn.style.marginLeft = '8px';
  btn.innerHTML = `
    <div class="yt-spec-button-shape-next__icon">
      <svg height="24" viewBox="0 0 24 24" width="24" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
        <path d="M12 2L9.19 8.63L2 9.24L7.65 13.97L5.82 21L12 17.27L18.18 21L16.35 13.97L22 9.24L14.81 8.63L12 2Z" fill="currentColor"></path>
      </svg>
    </div>
    <div class="yt-spec-button-shape-next__button-text-content">AI Özet</div>
  `;

  btn.addEventListener('click', () => {
    if (panelHiddenForTab) {
      // Geçici gizlenmiş — göster
      panelHiddenForTab = false;
      const vid = getVideoId();
      if (vid) mountPanel(vid);
    } else if (document.getElementById('zyoutube-panel-container')) {
      // Panel görünür — gizle
      panelHiddenForTab = true;
      unmountPanel();
    } else {
      // Panel yok — oluştur
      panelHiddenForTab = false;
      const vid = getVideoId();
      if (vid) mountPanel(vid);
    }
  });

  actionsRow.appendChild(btn);
  return true;
}

function updateButtonState() {
  const btn = document.getElementById('ai-summary-btn');
  if (!btn) return;

  const textEl = btn.querySelector('.yt-spec-button-shape-next__button-text-content');
  if (!textEl) return;

  const hasPanel = !!document.getElementById('zyoutube-panel-container');
  const newText = hasPanel ? 'Paneli Gizle' : 'AI Özet';
  if (textEl.textContent !== newText) {
    textEl.textContent = newText;
  }
}

// ─── Ana init akışı ─────────────────────────────

async function init() {
  console.log('ZYOUTUBE CONTENT SCRIPT INIT STARTING');
  const videoId = getVideoId();
  if (!videoId) {
    console.log('NO VIDEO ID');
    return;
  }
  console.log('VIDEO ID:', videoId);

  try {
    // Panel ayarlarını oku
    const panelSettings = await GemSettingsService.getPanelSettings();
    console.log('PANEL SETTINGS:', panelSettings.enabled);

    if (!panelSettings.enabled) {
      console.log('PANEL DISABLED');
    // Global pasif — panel kaldır
    unmountPanel();
    // Buton pasif
    const btn = document.getElementById('ai-summary-btn');
    if (btn) {
      const textEl = btn.querySelector('.yt-spec-button-shape-next__button-text-content');
      if (textEl) textEl.textContent = 'Pasif';
      btn.setAttribute('disabled', 'true');
      btn.style.opacity = '0.5';
    }
    return;
  }

  // Buton enjekte et
  let retries = 0;
  const interval = setInterval(() => {
    if (injectButton() || retries > 10) {
      clearInterval(interval);
      updateButtonState();
    }
    retries++;
  }, 1000);

  // Auto-open ise paneli mount et
  if (panelSettings.autoOpenOnWatchPage && !panelHiddenForTab) {
    if (videoId !== currentVideoId || !document.getElementById('zyoutube-panel-container')) {
      // Secondary alanı henüz yüklenmemiş olabilir
      let mountRetries = 0;
      const mountInterval = setInterval(() => {
        if (mountPanel(videoId) || mountRetries > 15) {
          clearInterval(mountInterval);
          updateButtonState();
        }
        mountRetries++;
      }, 800);
    }
  }
  } catch (err) {
    console.log('INIT ERROR:', err);
  }
}

// ─── SPA navigasyon ve storage listener ─────────

// İlk yükleme
if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
  init();
}

// SPA navigasyon
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'YOUTUBE_URL_CHANGED') {
    panelHiddenForTab = false; // Yeni videoda geçici gizleme sıfırla
    init();
  } else if (message.type === 'PANEL_SETTINGS_CHANGED') {
    // Popup'tan toggle değişimi
    init();
  } else if (message.type === 'COPY_TO_CLIPBOARD') {
    navigator.clipboard.writeText(message.text).catch(err => console.error('Panoya kopyalanamadı', err));
    if (sendResponse) sendResponse({ success: true });
  }
});

// Storage değişimi dinle (popup toggle anında yansıması)
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['panel_settings']) {
      const newSettings = changes['panel_settings'].newValue as PanelSettings;
      if (!newSettings?.enabled) {
        unmountPanel();
        updateButtonState();
      } else {
        panelHiddenForTab = false;
        init();
      }
    }
  });
}

// MutationObserver — SPA DOM değişimleri
const observer = new MutationObserver(() => {
  if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
    const videoId = getVideoId();
    if (videoId && videoId !== currentVideoId) {
      panelHiddenForTab = false;
      init();
    } else if (videoId) {
      injectButton();
      updateButtonState();
      // Panel kaybolmuşsa yeniden bağla
      if (!panelHiddenForTab && !document.getElementById('zyoutube-panel-container')) {
        GemSettingsService.getPanelSettings().then(ps => {
          if (ps.enabled && ps.autoOpenOnWatchPage) {
            mountPanel(videoId);
          }
        });
      }
      applyTheme();
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
