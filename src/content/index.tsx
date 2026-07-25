import { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import panelCss from '../styles/content-panel.css?inline';
import { TranscriptTab } from './TranscriptTab';
import { SummaryTab } from './components/SummaryTab';
import { GemSettingsService } from '../gem/settings';
import { PanelSettings } from '../gem/types';
import { sendRuntimeMessage, RuntimeMessengerError } from './runtime-messenger';

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
  private bootstrapObserver: MutationObserver | null = null;
  private storageListener: ((changes: any, areaName: string) => void) | null = null;
  private messageListener: ((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void) | null = null;

  // Navigation-scoped resources (cleared on SPA navigation)
  private navIntervals = new Set<number>();
  private navTimeouts = new Set<number>();

  // Persistent resources (kept across navigation)
  private persistentTimeouts = new Set<number>();



  constructor() {
    this.cleanupOldInstances();
  }

  private cleanupOldInstances() {
    document.querySelectorAll('[data-zyoutube-owner="extension"]').forEach(el => {
      if (el.getAttribute('data-zyoutube-build') !== BUILD_ID) {
        el.remove();
      }
    });
  }

  private setNavInterval(handler: TimerHandler, timeout?: number): number {
    const id = window.setInterval(handler, timeout);
    this.navIntervals.add(id);
    return id;
  }

  private clearNavInterval(id: number) {
    window.clearInterval(id);
    this.navIntervals.delete(id);
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
    this.navIntervals.forEach(id => window.clearInterval(id));
    this.navTimeouts.forEach(id => window.clearTimeout(id));
    this.navIntervals.clear();
    this.navTimeouts.clear();
    this.persistentTimeouts.forEach(id => window.clearTimeout(id));
    this.persistentTimeouts.clear();
    if (this.bootstrapObserver) {
      this.bootstrapObserver.disconnect();
      this.bootstrapObserver = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.renderPanel(this.currentVideoId);
  }

  // Clean up navigation-scoped resources only (intervals, timeouts, bootstrap observer)
  private clearNavigationResources() {
    this.navIntervals.forEach(id => window.clearInterval(id));
    this.navTimeouts.forEach(id => window.clearTimeout(id));
    this.navIntervals.clear();
    this.navTimeouts.clear();
    if (this.bootstrapObserver) {
      this.bootstrapObserver.disconnect();
      this.bootstrapObserver = null;
    }
  }

  // Full reset for SPA navigation: keeps persistent listeners, resets video state
  private resetForNavigation(newVideoId: string) {
    this.clearNavigationResources();
    this.currentVideoId = newVideoId;

    // Update existing panel host content if it exists, or it will be created by init()
    if (document.getElementById('zyoutube-panel-host')) {
      this.renderPanel(newVideoId);
    }
  }

  private async pingBackground(): Promise<boolean> {
    if (this.isInvalidated) return false;
    try {
      const response = await sendRuntimeMessage<{ type: 'PING_BACKGROUND' }, { success: boolean }>(
        { type: 'PING_BACKGROUND' },
        { timeoutMs: 3000 }
      );
      return response?.success === true;
    } catch (e: any) {
      if (e instanceof RuntimeMessengerError) {
        if (e.code === 'EXTENSION_CONTEXT_INVALIDATED') {
          this.handleContextInvalidated();
        }
      } else if (e.message?.includes('invalidated') || e.message?.includes('Extension context')) {
        this.handleContextInvalidated();
      }
      return false;
    }
  }

  private mountPanel(videoId: string): boolean {
    const secondary = document.querySelector('#secondary-inner') || document.querySelector('#secondary');
    if (!secondary) {
      console.warn('ZYouTube: mountPanel failed! Could not find #secondary-inner or #secondary in the DOM.');
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
    const actionsRow = document.querySelector('#top-level-buttons-computed') || document.querySelector('ytd-menu-renderer #top-level-buttons') || document.querySelector('#actions-inner');
    if (!actionsRow) return false;

    if (document.getElementById('zyoutube-toggle-button')) return true;

    const btn = document.createElement('button');
    btn.id = 'zyoutube-toggle-button';
    btn.className = 'zyoutube-toggle-button';
    btn.setAttribute('data-zyoutube-owner', 'extension');
    btn.setAttribute('data-zyoutube-build', BUILD_ID);
    btn.innerHTML = `
      <span class="zyoutube-toggle-icon">
        <svg height="24" viewBox="0 0 24 24" width="24" focusable="false" style="pointer-events: none; display: block; width: 24px; height: 24px;">
          <path d="M12 2L9.19 8.63L2 9.24L7.65 13.97L5.82 21L12 17.27L18.18 21L16.35 13.97L22 9.24L14.81 8.63L12 2Z" fill="currentColor"></path>
        </svg>
      </span>
      <span class="zyoutube-toggle-label">AI Özet</span>
    `;

    btn.addEventListener('click', () => {
      console.warn('ZYouTube: Button clicked. isInvalidated:', this.isInvalidated, 'panelHidden:', this.panelHiddenForTab);
      if (this.isInvalidated) {
        alert('ZYouTube: Eklenti güncellendiği için sayfanın yenilenmesi gerekiyor. Lütfen sayfayı yenileyin (F5).');
        return;
      }
      if (this.panelHiddenForTab) {
        this.panelHiddenForTab = false;
        const vid = this.getVideoId();
        if (vid) {
          this.mountPanel(vid);
        }
      } else if (document.getElementById('zyoutube-panel-host')) {
        this.panelHiddenForTab = true;
        this.unmountPanel();
      } else {
        this.panelHiddenForTab = false;
        const vid = this.getVideoId();
        if (vid) {
          this.mountPanel(vid);
        }
      }
      this.updateButtonState();
    });

    // Inject scoped button styles (only if not already present)
    if (!document.getElementById('zyoutube-toggle-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'zyoutube-toggle-styles';
      styleEl.textContent = `
        .zyoutube-toggle-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-left: 8px;
          padding: 0 12px;
          height: 36px;
          border: none;
          border-radius: 18px;
          background: #f2f2f2;
          color: #0f0f0f;
          font-family: 'YouTube Sans', Roboto, Arial, sans-serif;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .zyoutube-toggle-button:hover {
          background: #d9d9d9;
        }
        .zyoutube-toggle-button:active {
          background: #c7c7c7;
        }
        .zyoutube-toggle-button[disabled] {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .zyoutube-toggle-icon {
          display: inline-flex;
          align-items: center;
          width: 24px;
          height: 24px;
          flex-shrink: 0;
        }
        .zyoutube-toggle-label {
          display: inline-flex;
          align-items: center;
        }
      `;
      document.head.appendChild(styleEl);
    }

    if (actionsRow.firstChild) {
      actionsRow.insertBefore(btn, actionsRow.firstChild);
    } else {
      actionsRow.appendChild(btn);
    }
    return true;
  }

  private updateButtonState() {
    const btn = document.getElementById('zyoutube-toggle-button');
    if (!btn) return;
    const textEl = btn.querySelector('.zyoutube-toggle-label');
    if (!textEl) return;

    const hasPanel = !!document.getElementById('zyoutube-panel-host');
    const newText = hasPanel ? 'Paneli Gizle' : 'AI Özet';
    if (textEl.textContent !== newText) {
      textEl.textContent = newText;
    }
  }

  private setupBootstrapObserver() {
    if (this.bootstrapObserver) return;

    const maxWaitMs = 8000;

    this.bootstrapObserver = new MutationObserver(() => {
      const secondaryFound = !!document.querySelector('#secondary') || !!document.querySelector('#secondary-inner');
      const buttonRowFound = !!document.querySelector('#top-level-buttons-computed');

      if (secondaryFound && buttonRowFound) {
        this.bootstrapObserver?.disconnect();
        this.bootstrapObserver = null;
        this.init();
      }
    });

    this.bootstrapObserver.observe(document.body, { childList: true, subtree: true });

    const timeoutId = window.setTimeout(() => {
      if (this.bootstrapObserver) {
        this.bootstrapObserver.disconnect();
        this.bootstrapObserver = null;
        this.init();
      }
    }, maxWaitMs);
    this.persistentTimeouts.add(timeoutId);
  }

  public async init() {
    if (this.isInvalidated) return;

    const videoId = this.getVideoId();
    if (!videoId) return;

    // If video changed, reset navigation-scoped resources
    if (videoId !== this.currentVideoId && this.currentVideoId !== '') {
      this.resetForNavigation(videoId);
    }

    try {
      const pingOk = await this.pingBackground();
      if (!pingOk && this.isInvalidated) return;

      const panelSettings = await GemSettingsService.getPanelSettings();

      if (!panelSettings.enabled) {
        this.unmountPanel();
        const btn = document.getElementById('zyoutube-toggle-button');
        if (btn) {
          const textEl = btn.querySelector('.zyoutube-toggle-label');
          if (textEl) textEl.textContent = 'Pasif';
          btn.setAttribute('disabled', 'true');
          btn.style.opacity = '0.5';
        }
        return;
      }

      // Inject button with bounded retry
      let buttonRetries = 0;
      const btnInterval = this.setNavInterval(() => {
        if (this.injectButton() || buttonRetries > 10) {
          this.clearNavInterval(btnInterval);
          this.updateButtonState();
        }
        buttonRetries++;
      }, 1000);

      // Mount panel if auto-open is enabled
      if (panelSettings.autoOpenOnWatchPage && !this.panelHiddenForTab) {
        if (!document.getElementById('zyoutube-panel-host')) {
          let mountRetries = 0;
          const mountInterval = this.setNavInterval(() => {
            if (this.mountPanel(videoId) || mountRetries > 10) {
              this.clearNavInterval(mountInterval);
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
    this.setupBootstrapObserver();

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

    // Persistent observer for secondary re-attach (only after bootstrap done)
    this.persistentTimeouts.add(window.setTimeout(() => {
      const secondaryTarget = document.querySelector('#secondary');
      if (!secondaryTarget) {
        this.observer = new MutationObserver(() => {
          const sec = document.querySelector('#secondary');
          if (sec && !document.getElementById('zyoutube-panel-host')) {
            const vid = this.getVideoId();
            if (vid) this.mountPanel(vid);
          }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
      }
    }, 10000));
  }

  public destroy() {
    this.navIntervals.forEach(id => window.clearInterval(id));
    this.navTimeouts.forEach(id => window.clearTimeout(id));
    this.navIntervals.clear();
    this.navTimeouts.clear();

    this.persistentTimeouts.forEach(id => window.clearTimeout(id));
    this.persistentTimeouts.clear();

    if (this.bootstrapObserver) {
      this.bootstrapObserver.disconnect();
      this.bootstrapObserver = null;
    }
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
    const btn = document.getElementById('zyoutube-toggle-button');
    if (btn) btn.remove();
    const styleEl = document.getElementById('zyoutube-toggle-styles');
    if (styleEl) styleEl.remove();
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
