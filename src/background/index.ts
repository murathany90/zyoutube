import { SummaryRequest } from '../ai/types';
import { setupAIMessageHandlers } from './ai-message-handler';
import { GemSettingsService } from '../gem/settings';

export type ExtensionMessage =
  | { type: 'YOUTUBE_URL_CHANGED'; url: string }
  | { type: 'GET_PLAYER_RESPONSE'; requestId: string; expectedVideoId: string }
  | { type: 'FETCH_CAPTION'; requestId: string; url: string }
  | { type: 'START_SUMMARY'; request: SummaryRequest }
  | { type: 'CANCEL_SUMMARY'; taskId: string }
  | { type: 'GET_PANEL_SETTINGS' }
  | { type: 'GET_GEM_SETTINGS' }
  | { type: 'PANEL_SETTINGS_CHANGED' }
  | { type: 'COPY_TO_CLIPBOARD'; text: string };

console.log('Background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('ZYouTube Extension Installed.');
  // Migration
  GemSettingsService.migrateFromGeminiApi().then(r => {
    if (r.migrated) console.log('Migration:', r.message);
  });
});

setupAIMessageHandlers();

// Tab updates for SPA navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && (tab.url?.includes('youtube.com/watch') || tab.url?.includes('localhost:3000'))) {
    chrome.tabs.sendMessage(tabId, { type: 'YOUTUBE_URL_CHANGED', url: changeInfo.url }).catch(() => {});
  }
});

// MAIN world injection for player response
function fetchPlayerResponseFromMainWorld(): any {
  try {
    const p = (window as any).ytInitialPlayerResponse;
    if (p) {
      return {
        videoId: p.videoDetails?.videoId,
        durationMs: p.videoDetails?.lengthSeconds ? parseInt(p.videoDetails.lengthSeconds) * 1000 : null,
        captionTracks: p.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((c: any) => ({
          baseUrl: c.baseUrl,
          languageCode: c.languageCode,
          name: c.name?.simpleText || '',
          kind: c.kind,
          isTranslatable: c.isTranslatable,
        })) || []
      };
    }
  } catch (e) {
    return { error: 'Failed to extract' };
  }
  return null;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  // Panel/Gem settings requests (from popup — no tab required)
  if (message.type === 'GET_PANEL_SETTINGS') {
    GemSettingsService.getPanelSettings().then(s => sendResponse(s)).catch(() => sendResponse(null));
    return true;
  }
  if (message.type === 'GET_GEM_SETTINGS') {
    GemSettingsService.getGemSettings().then(s => sendResponse(s)).catch(() => sendResponse(null));
    return true;
  }

  // Clipboard (from content script)
  if (message.type === 'COPY_TO_CLIPBOARD') {
    // Service worker'da clipboard API mevcut değil, content script'e devredilir
    return;
  }

  // Tab-dependent messages
  if (!sender.tab?.id) return;
  if (sender.frameId !== 0) return;
  if (!sender.tab.url?.includes('youtube.com/watch') && !sender.tab.url?.includes('localhost:3000')) return;

  if (message.type === 'GET_PLAYER_RESPONSE') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, frameIds: [0] },
      world: 'MAIN',
      func: fetchPlayerResponseFromMainWorld,
    }).then(results => {
      const result = results[0]?.result;
      if (result && result.videoId === message.expectedVideoId) {
        sendResponse({ success: true, data: result });
      } else {
        sendResponse({ success: false, error: 'VideoId mismatch or not found' });
      }
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }

  if (message.type === 'FETCH_CAPTION') {
    try {
      const url = new URL(message.url);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        sendResponse({ success: false, error: 'Invalid protocol' });
        return;
      }
      if (!url.hostname.endsWith('youtube.com') && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        sendResponse({ success: false, error: 'Invalid host' });
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      fetch(url.toString(), { signal: controller.signal })
        .then(res => {
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('xml') && !url.hostname.includes('localhost')) {
            throw new Error('Invalid content type');
          }
          return res.text();
        })
        .then(text => {
          if (text.length > 5000000) throw new Error('Response too large');
          sendResponse({ success: true, data: text });
        })
        .catch(err => {
          sendResponse({ success: false, error: err.message });
        });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});
