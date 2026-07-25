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
  | { type: 'COPY_TO_CLIPBOARD'; text: string }
  | { type: 'TEST_CONNECTION'; providerId: any };

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
function fetchPlayerResponseFromMainWorld(expectedVideoId: string): any {
  let source = 'none';
  let p: any = null;

  try {
    // 1. movie_player
    const moviePlayer = document.getElementById('movie_player') as any;
    if (moviePlayer) {
      if (typeof moviePlayer.getPlayerResponse === 'function') {
        const pr = moviePlayer.getPlayerResponse();
        const parsed = typeof pr === 'string' ? JSON.parse(pr) : pr;
        if (parsed?.videoDetails?.videoId === expectedVideoId) {
          p = parsed;
          source = 'movie_player';
        }
      }
      if (!p && typeof moviePlayer.getPlayerData === 'function') {
        const pd = moviePlayer.getPlayerData();
        const parsed = typeof pd === 'string' ? JSON.parse(pd) : pd;
        if (parsed?.videoDetails?.videoId === expectedVideoId) {
          p = parsed;
          source = 'movie_player';
        }
      }
    }

    // 2. ytd-player
    if (!p) {
      const ytdPlayer = document.querySelector('ytd-player') as any;
      if (ytdPlayer) {
        const pr = ytdPlayer.playerResponse || ytdPlayer.getPlayerResponse?.() || (ytdPlayer.player_ && ytdPlayer.player_.getPlayerResponse?.());
        const parsed = typeof pr === 'string' ? JSON.parse(pr) : pr;
        if (parsed?.videoDetails?.videoId === expectedVideoId) {
          p = parsed;
          source = 'ytd-player';
        }
      }
    }

    // 3. ytd-watch-flexy
    if (!p) {
      const flexy = document.querySelector('ytd-watch-flexy') as any;
      if (flexy) {
        const pr = flexy.playerResponse || flexy.data?.playerResponse;
        const parsed = typeof pr === 'string' ? JSON.parse(pr) : pr;
        if (parsed?.videoDetails?.videoId === expectedVideoId) {
          p = parsed;
          source = 'watch-flexy';
        }
      }
    }

    // 4. ytplayer.config
    if (!p) {
      const config = (window as any).ytplayer?.config;
      const raw = config?.args?.raw_player_response;
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed?.videoDetails?.videoId === expectedVideoId) {
          p = parsed;
          source = 'ytplayer-config';
        }
      }
    }

    // 5. ytInitialPlayerResponse
    if (!p) {
      const initP = (window as any).ytInitialPlayerResponse;
      const parsed = typeof initP === 'string' ? JSON.parse(initP) : initP;
      if (parsed?.videoDetails?.videoId === expectedVideoId) {
        p = parsed;
        source = 'initial-player-response';
      }
    }

    // Return format
    if (p) {
      const trackList = p.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      return {
        videoId: p.videoDetails?.videoId,
        durationMs: p.videoDetails?.lengthSeconds ? parseInt(p.videoDetails.lengthSeconds) * 1000 : null,
        captionTracks: trackList.map((c: any) => ({
          baseUrl: c.baseUrl,
          languageCode: c.languageCode,
          name: c.name?.simpleText || '',
          kind: c.kind,
          isTranslatable: c.isTranslatable,
        })),
        diagnostics: {
          expectedVideoId,
          detectedVideoId: p.videoDetails?.videoId,
          extractionSource: source,
          playerResponseFound: true,
          captionsObjectFound: !!p.captions,
          trackCount: trackList.length,
          trackLanguages: trackList.map((c: any) => c.languageCode),
          retryCount: 0,
        }
      };
    }
  } catch (e: any) {
    return { error: 'Failed to extract: ' + e.message, source };
  }
  
  return {
    diagnostics: {
      expectedVideoId,
      extractionSource: source,
      playerResponseFound: false,
      captionsObjectFound: false,
      trackCount: 0,
      trackLanguages: [],
      retryCount: 0,
    }
  };
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

  if (message.type === 'TEST_CONNECTION') {
    import('../ai/registry').then(({ AIProviderRegistry }) => {
      const provider = AIProviderRegistry.getProvider(message.providerId);
      if (!provider) {
         sendResponse({ success: false, message: 'Provider bulunamadı' });
      } else {
         provider.testConnection().then(sendResponse).catch((e: any) => sendResponse({ success: false, message: e.message }));
      }
    }).catch(() => sendResponse({ success: false, message: 'Registry module error' }));
    return true;
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
      args: [message.expectedVideoId]
    }).then(results => {
      const result = results[0]?.result;
      // result now contains diagnostics
      if (result && result.videoId === message.expectedVideoId) {
        sendResponse({ success: true, data: result });
      } else {
        // Return diagnostics even if videoId mismatch so the caller knows what happened
        sendResponse({ success: false, error: 'VideoId mismatch or not found', data: result });
      }
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }

  if (message.type === 'FETCH_CAPTION') {
    try {
      const url = new URL(message.url);
      
      // Security validations
      const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isTestEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process && (globalThis as any).process.env.NODE_ENV === 'test') || isLocalhost; 

      if (!isTestEnv) {
        if (url.protocol !== 'https:') {
          sendResponse({ success: false, error: 'HTTPS required' });
          return true;
        }
        if (url.username || url.password) {
          sendResponse({ success: false, error: 'Credentials in URL not allowed' });
          return true;
        }
        if (!url.hostname.endsWith('.youtube.com') && url.hostname !== 'youtube.com') {
          sendResponse({ success: false, error: 'Invalid host' });
          return true;
        }
        if (!url.pathname.startsWith('/api/timedtext')) {
          sendResponse({ success: false, error: 'Invalid path' });
          return true;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      fetch(url.toString(), { signal: controller.signal, redirect: 'follow' })
        .then(res => {
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          // Post-redirect validation
          if (!isTestEnv) {
            const finalUrl = new URL(res.url);
            if (!finalUrl.hostname.endsWith('.youtube.com') && finalUrl.hostname !== 'youtube.com') {
              throw new Error('Redirected to invalid host');
            }
          }

          const contentType = res.headers.get('content-type') || '';
          const validTypes = ['application/json', 'text/json', 'text/xml', 'application/xml', 'text/plain'];
          
          if (!validTypes.some(t => contentType.includes(t)) && !isTestEnv) {
             throw new Error('Invalid content type: ' + contentType);
          }
          return res.text();
        })
        .then(text => {
          if (text.length > 5000000) throw new Error('Response too large');
          if (text.trim().toLowerCase().startsWith('<!doctype html>')) {
             throw new Error('İstek belirtilmeyen bir nedenle engellendi.');
          }
          sendResponse({ success: true, data: text });
        })
        .catch(err => {
          sendResponse({ success: false, error: err.name === 'AbortError' ? 'Timeout' : err.message });
        });
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});
