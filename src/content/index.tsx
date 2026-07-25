import { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import panelCss from '../styles/content-panel.css?inline';
import { TranscriptTab } from './TranscriptTab';
import { SummaryTab } from './components/SummaryTab';
import { GemSettingsService } from '../gem/settings';
import { PanelSettings } from '../gem/types';

// ============================================================================
// COMPONENT: EXTENSION INVALIDATED
// ============================================================================
const ExtensionInvalidated = () => (
  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--zy-error-text, #dc2626)' }}>
    <h3 style={{ fontWeight: 'bold', marginBottom: '12px' }}>Eklenti Yenilendi</h3>
    <p style={{ marginBottom: '16px', fontSize: '13px' }}>
      Eklenti yeniden yüklendiği için bu YouTube sekmesindeki eski bağlantı artık kullanılamıyor. Devam etmek için sayfayı yenileyin.
    </p>
    <button
      onClick={() => window.location.reload()}
      style={{
        padding: '8px 16px',
        backgroundColor: '#ef4444',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        fontWeight: 'bold',
        cursor: 'pointer'
      }}
    >
      Sayfayı Yenile
    </button>
  </div>
);

// ============================================================================
// MAIN PANEL COMPONENT
// ============================================================================
type PanelTab = 'summary' | 'transcript' | 'keyideas' | 'ask' | 'learn';

const Panel = ({ videoId, onClose, isInvalidated }: { videoId: string; onClose: () => void, isInvalidated: boolean }) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('summary');
  const title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || 'Bilinmeyen Video';
  const url = window.location.href;

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
    <div className="zyoutube-root" style={{
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

      {isInvalidated ? (
        <ExtensionInvalidated />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};

// ============================================================================
// CONTROLLER: YOUTUBE CONTENT LIFECYCLE
// ============================================================================

const BUILD_ID = chrome.runtime?.getManifest?.()?.version || 'unknown';

class YouTubeContentController {
  private panelRoot: Root | null = null;
  private currentVideoId: string = '';
  private panelHiddenForTab: boolean = false;
  private isInvalidated: boolean = false;
  private observer: MutationObserver | null = null;
  private storageListener: ((changes: any, areaName: string) => void) | null = null;
  private messageListener: ((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void) | null = null;
  
  private intervals = new Set<number>();
  private timeouts = new Set<number>();
  
  private injectDebounceTimer: number | null = null;

  constructor() {
    this.cleanupOldInstances();
  }

  // Eski sürümlerden kalma DOM parçalarını temizle
  private cleanupOldInstances() {
    document.querySelectorAll('[data-zyoutube-owner="extension"]').forEach(el => {
      if (el.getAttribute('data-zyoutube-build') !== BUILD_ID) {
        el.remove();
      }
    });
  }

  private setIntervalSafe(handler: TimerHandler, timeout?: number): number {
    const id = window.setInterval(handler, timeout);
    this.intervals.add(id);
    return id;
  }

  private clearIntervalSafe(id: number) {
    window.clearInterval(id);
    this.intervals.delete(id);
  }

  private getVideoId(): string | null {
    if (window.location.href.includes('youtube.com/watch')) {
      return new URLSearchParams(window.location.search).get('v');
    }
    if (window.location.href.includes('localhost:3000')) {
      return new URLSearchParams(window.location.search).get('v') || 'dQw4w9WgXcQ';
    }
    return null;
  }

  private getPlayerHeight(): number {
    const player = document.querySelector('#player-container-outer, #movie_player, .html5-video-player') as HTMLElement;
    if (player) {
      const rect = player.getBoundingClientRect();
      if (rect.height > 200) return Math.round(rect.height);
    }
    return 500;
  }

  private applyTheme(container: HTMLElement) {
    const isDark = document.documentElement.getAttribute('dark') !== null ||
      document.querySelector('html[dark]') !== null ||
      getComputedStyle(document.body).backgroundColor.includes('rgb(15') ||
      getComputedStyle(document.body).backgroundColor.includes('rgb(32');

    const newBg = isDark ? '#1f1f1f' : '#f9fafb';
    if (container.style.getPropertyValue('--zy-bg') !== newBg) {
      container.style.setProperty('--zy-bg', newBg);
      container.style.setProperty('--zy-card-bg', isDark ? '#2a2a2a' : '#ffffff');
      container.style.setProperty('--zy-header-bg', isDark ? '#282828' : '#ffffff');
      container.style.setProperty('--zy-text', isDark ? '#e5e7eb' : '#111827');
      container.style.setProperty('--zy-text-muted', isDark ? '#9ca3af' : '#4b5563');
      container.style.setProperty('--zy-border', isDark ? '#3f3f46' : '#e5e7eb');
      
      container.style.setProperty('--zy-item-bg', isDark ? '#3f3f46' : '#f3f4f6');
      container.style.setProperty('--zy-item-hover', isDark ? '#52525b' : '#e5e7eb');
      container.style.setProperty('--zy-error-bg', isDark ? '#7f1d1d' : '#fef2f2');
      container.style.setProperty('--zy-error-border', isDark ? '#991b1b' : '#fecaca');
      container.style.setProperty('--zy-error-text', isDark ? '#fca5a5' : '#dc2626');
      container.style.setProperty('--zy-card-inner', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)');
    }
  }

  public handleContextInvalidated() {
    if (this.isInvalidated) return;
    this.isInvalidated = true;
    
    // Stop all active logic
    this.intervals.forEach(id => window.clearInterval(id));
    this.timeouts.forEach(id => window.clearTimeout(id));
    this.intervals.clear();
    this.timeouts.clear();
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    this.renderPanel(this.currentVideoId); // Show invalidated UI
  }

  private async pingBackground(): Promise<boolean> {
    if (this.isInvalidated) return false;
    return new Promise((resolve) => {
      try {
        if (!chrome?.runtime?.sendMessage) throw new Error('No runtime');
        chrome.runtime.sendMessage({ type: 'PING_BACKGROUND' }, (response) => {
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message?.includes('invalidated')) {
              this.handleContextInvalidated();
            }
            resolve(false);
          } else {
            resolve(response?.success === true);
          }
        });
      } catch (e: any) {
        if (e.message?.includes('invalidated') || e.message?.includes('Extension context')) {
          this.handleContextInvalidated();
        }
        resolve(false);
      }
    });
  }

  private mountPanel(videoId: string): boolean {
    const secondary = document.querySelector('#secondary-inner') || document.querySelector('#secondary');
    if (!secondary) {
      console.log('ZYouTube: mountPanel failed! Could not find #secondary-inner or #secondary in the DOM.');
      return false;
    }

    if (document.getElementById('zyoutube-panel-host')) {
      if (videoId !== this.currentVideoId) {
        this.currentVideoId = videoId;
        this.renderPanel(videoId);
      }
      return true;
    }

    const host = document.createElement('div');
    host.id = 'zyoutube-panel-host';
    host.setAttribute('data-zyoutube-owner', 'extension');
    host.setAttribute('data-zyoutube-build', BUILD_ID);
    
    const shadowRoot = host.attachShadow({ mode: 'open' });
    
    // Inject scoped CSS
    const style = document.createElement('style');
    style.textContent = panelCss;
    shadowRoot.appendChild(style);

    const reactRoot = document.createElement('div');
    reactRoot.id = 'zyoutube-react-root';
    reactRoot.style.setProperty('--zy-panel-height', this.getPlayerHeight() + 'px');
    shadowRoot.appendChild(reactRoot);

    secondary.insertBefore(host, secondary.firstChild);

    this.applyTheme(reactRoot);

    this.panelRoot = createRoot(reactRoot);
    this.currentVideoId = videoId;
    this.panelHiddenForTab = false;
    this.renderPanel(videoId);

    return true;
  }

  private renderPanel(videoId: string) {
    if (!this.panelRoot) return;
    this.panelRoot.render(
      <Panel
        videoId={videoId}
        isInvalidated={this.isInvalidated}
        onClose={() => {
          this.panelHiddenForTab = true;
          this.unmountPanel();
          this.updateButtonState();
        }}
      />
    );
  }

  private unmountPanel() {
    const host = document.getElementById('zyoutube-panel-host');
    if (host) {
      if (this.panelRoot) {
        this.panelRoot.unmount();
        this.panelRoot = null;
      }
      host.remove();
    }
  }

  private injectButton(): boolean {
    const actionsRow = document.querySelector('#top-level-buttons-computed');
    if (!actionsRow) return false;

    if (document.getElementById('ai-summary-btn')) return true;

    const btn = document.createElement('button');
    btn.id = 'ai-summary-btn';
    btn.setAttribute('data-zyoutube-owner', 'extension');
    btn.setAttribute('data-zyoutube-build', BUILD_ID);
    // Minimal classes to match youtube style without bringing tailwind issues
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
      console.log('ZYouTube: Button clicked. isInvalidated:', this.isInvalidated, 'panelHidden:', this.panelHiddenForTab);
      if (this.isInvalidated) return;
      if (this.panelHiddenForTab) {
        this.panelHiddenForTab = false;
        const vid = this.getVideoId();
        console.log('ZYouTube: videoId:', vid);
        if (vid) {
           const mounted = this.mountPanel(vid);
           console.log('ZYouTube: mountPanel result:', mounted);
        }
      } else if (document.getElementById('zyoutube-panel-host')) {
        this.panelHiddenForTab = true;
        this.unmountPanel();
      } else {
        this.panelHiddenForTab = false;
        const vid = this.getVideoId();
        console.log('ZYouTube: videoId (else):', vid);
        if (vid) {
           const mounted = this.mountPanel(vid);
           console.log('ZYouTube: mountPanel result (else):', mounted);
        }
      }
      this.updateButtonState();
    });

    actionsRow.appendChild(btn);
    return true;
  }

  private updateButtonState() {
    const btn = document.getElementById('ai-summary-btn');
    if (!btn) return;
    const textEl = btn.querySelector('.yt-spec-button-shape-next__button-text-content');
    if (!textEl) return;

    const hasPanel = !!document.getElementById('zyoutube-panel-host');
    const newText = hasPanel ? 'Paneli Gizle' : 'AI Özet';
    if (textEl.textContent !== newText) {
      textEl.textContent = newText;
    }
  }

  public async init() {
    if (this.isInvalidated) return;
    
    const videoId = this.getVideoId();
    if (!videoId) return;

    try {
      const pingOk = await this.pingBackground();
      if (!pingOk && this.isInvalidated) return;

      const panelSettings = await GemSettingsService.getPanelSettings();

      if (!panelSettings.enabled) {
        this.unmountPanel();
        const btn = document.getElementById('ai-summary-btn');
        if (btn) {
          const textEl = btn.querySelector('.yt-spec-button-shape-next__button-text-content');
          if (textEl) textEl.textContent = 'Pasif';
          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';
        }
        return;
      }

      let retries = 0;
      const interval = this.setIntervalSafe(() => {
        if (this.injectButton() || retries > 10) {
          this.clearIntervalSafe(interval);
          this.updateButtonState();
        }
        retries++;
      }, 1000);

      if (panelSettings.autoOpenOnWatchPage && !this.panelHiddenForTab) {
        if (videoId !== this.currentVideoId || !document.getElementById('zyoutube-panel-host')) {
          let mountRetries = 0;
          const mountInterval = this.setIntervalSafe(() => {
            if (this.mountPanel(videoId) || mountRetries > 15) {
              this.clearIntervalSafe(mountInterval);
              this.updateButtonState();
            }
            mountRetries++;
          }, 800);
        }
      }
    } catch (err) {
      console.error('INIT ERROR', err);
    }
  }

  public start() {
    this.init();

    this.messageListener = (message, _sender, sendResponse) => {
      if (message.type === 'YOUTUBE_URL_CHANGED') {
        this.panelHiddenForTab = false;
        this.init();
      } else if (message.type === 'PANEL_SETTINGS_CHANGED') {
        this.init();
      } else if (message.type === 'COPY_TO_CLIPBOARD') {
        navigator.clipboard.writeText(message.text).catch(err => console.error('Panoya kopyalanamadı', err));
        if (sendResponse) sendResponse({ success: true });
      }
    };
    chrome.runtime.onMessage.addListener(this.messageListener);

    if (typeof chrome !== 'undefined' && chrome.storage) {
      this.storageListener = (changes, area) => {
        if (area === 'local' && changes['panel_settings']) {
          const newSettings = changes['panel_settings'].newValue as PanelSettings;
          if (!newSettings?.enabled) {
            this.unmountPanel();
            this.updateButtonState();
          } else {
            this.panelHiddenForTab = false;
            this.init();
          }
        }
      };
      chrome.storage.onChanged.addListener(this.storageListener);
    }

    this.observer = new MutationObserver((mutations) => {
      if (this.isInvalidated) return;
      
      let relevantMutation = false;
      for (const mutation of mutations) {
        if (mutation.target instanceof Element) {
          const id = mutation.target.id;
          const tag = mutation.target.tagName.toLowerCase();
          if (id === 'secondary' || id === 'secondary-inner' || id === 'top-level-buttons-computed' || tag === 'ytd-watch-flexy') {
            relevantMutation = true;
            break;
          }
        }
      }

      if (!relevantMutation) return;

      if (this.injectDebounceTimer) {
        window.clearTimeout(this.injectDebounceTimer);
      }
      
      this.injectDebounceTimer = window.setTimeout(() => {
        if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
          const videoId = this.getVideoId();
          if (videoId && videoId !== this.currentVideoId) {
            this.panelHiddenForTab = false;
            this.init();
          } else if (videoId) {
            this.injectButton();
            this.updateButtonState();
            if (!this.panelHiddenForTab && !document.getElementById('zyoutube-panel-host')) {
              GemSettingsService.getPanelSettings().then(ps => {
                if (ps.enabled && ps.autoOpenOnWatchPage) {
                  this.mountPanel(videoId);
                }
              }).catch(() => {});
            }
            const reactRoot = document.getElementById('zyoutube-react-root');
            if (reactRoot) this.applyTheme(reactRoot);
          }
        }
      }, 250); // Debounce
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  public destroy() {
    this.intervals.forEach(id => window.clearInterval(id));
    this.timeouts.forEach(id => window.clearTimeout(id));
    this.intervals.clear();
    this.timeouts.clear();

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.messageListener) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
    }
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
    }

    this.unmountPanel();
    const btn = document.getElementById('ai-summary-btn');
    if (btn) btn.remove();
  }
}

// ============================================================================
// BOOTSTRAP
// ============================================================================

// Eğer bu script önceden enjekte edildiyse eski controller'ı yok et
if ((window as any).__zyoutube_controller__) {
  try {
    (window as any).__zyoutube_controller__.destroy();
  } catch (e) {}
}

const controller = new YouTubeContentController();
(window as any).__zyoutube_controller__ = controller;

if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
  controller.start();
}
