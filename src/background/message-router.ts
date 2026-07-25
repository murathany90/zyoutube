import { SummaryRequest } from '../ai/types';
import { AITaskManager } from '../ai/task-manager';
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
  | { type: 'PING_BACKGROUND' }
  | { type: 'TEST_CONNECTION'; providerId: any };

export function setupMessageRouter() {
  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    // 1. PING_BACKGROUND - no tab required, always first
    if (message.type === 'PING_BACKGROUND') {
      sendResponse({
        success: true,
        extensionVersion: chrome.runtime.getManifest().version,
        buildId: chrome.runtime.getManifest().version,
        timestamp: Date.now()
      });
      return true;
    }

    // 2. Settings requests - no tab required
    if (message.type === 'GET_PANEL_SETTINGS') {
      GemSettingsService.getPanelSettings().then(s => sendResponse(s)).catch(() => sendResponse(null));
      return true;
    }
    if (message.type === 'GET_GEM_SETTINGS') {
      GemSettingsService.getGemSettings().then(s => sendResponse(s)).catch(() => sendResponse(null));
      return true;
    }

    // 3. START_SUMMARY - requires tab context
    if (message.type === 'START_SUMMARY') {
      const { request } = message;
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ success: false, error: 'No tab context for START_SUMMARY' });
        return true;
      }

      AITaskManager.startTask(request, tabId, (status, msg, progress) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_PROGRESS',
          taskId: request.taskId,
          status,
          message: msg,
          progress
        }).catch(() => {});
      }).then((result) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_COMPLETED',
          taskId: request.taskId,
          result
        }).catch(() => {});
      }).catch((error) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_FAILED',
          taskId: request.taskId,
          error: {
            code: error.code || 'UNKNOWN_ERROR',
            userMessage: error.userMessage || error.message || 'Bir hata oluştu.',
            retryable: error.retryable ?? true
          }
        }).catch(() => {});
      });

      sendResponse({ success: true });
      return true;
    }

    // 4. CANCEL_SUMMARY - requires tab context
    if (message.type === 'CANCEL_SUMMARY') {
      const { taskId } = message;
      AITaskManager.cancelTask(taskId).catch(console.error);
      sendResponse({ success: true });
      return true;
    }

    // 5. Clipboard passthrough to content script
    if (message.type === 'COPY_TO_CLIPBOARD') {
      return;
    }

    // 6. TEST_CONNECTION - no tab required
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

    // Tab-dependent messages below this point
    if (!sender.tab?.id) return;
    if (sender.frameId !== 0) return;
    if (!sender.tab.url?.includes('youtube.com/watch') && !sender.tab.url?.includes('localhost:3000')) return;

    // 7. GET_PLAYER_RESPONSE
    if (message.type === 'GET_PLAYER_RESPONSE') {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id, frameIds: [0] },
        world: 'MAIN',
        func: fetchPlayerResponseFromMainWorld,
        args: [message.expectedVideoId]
      }).then(results => {
        const result = results[0]?.result;
        if (result && result.videoId === message.expectedVideoId) {
          sendResponse({ success: true, data: result });
        } else {
          sendResponse({ success: false, error: 'VideoId mismatch or not found', data: result });
        }
      }).catch(e => {
        sendResponse({ success: false, error: e.message });
      });
      return true;
    }

    // 8. FETCH_CAPTION
    if (message.type === 'FETCH_CAPTION') {
      handleFetchCaption(message, sendResponse);
      return true;
    }

    // Unknown message type
    console.warn(`[Background] Unknown message type:`, (message as any).type);
    sendResponse({ success: false, error: 'Unknown message type' });
    return true;
  });
}

function handleFetchCaption(message: any, sendResponse: (response: any) => void) {
  try {
    const url = new URL(message.url);
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const isTestEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process && (globalThis as any).process.env.NODE_ENV === 'test') || isLocalhost;

    if (!isTestEnv) {
      if (url.protocol !== 'https:') {
        sendResponse({ success: false, error: 'HTTPS required' });
        return;
      }
    }
    sendResponse({ success: false, error: 'Not implemented' });
  } catch (e: any) {
    sendResponse({ success: false, error: e.message });
  }
}

function fetchPlayerResponseFromMainWorld(expectedVideoId: string): any {
  let source = 'none';
  let p: any = null;

  try {
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

    if (!p) {
      const initP = (window as any).ytInitialPlayerResponse;
      const parsed = typeof initP === 'string' ? JSON.parse(initP) : initP;
      if (parsed?.videoDetails?.videoId === expectedVideoId) {
        p = parsed;
        source = 'initial-player-response';
      }
    }

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
