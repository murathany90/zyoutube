import { SummaryRequest } from '../ai/types';
import { setupAIMessageHandlers } from './ai-message-handler';

export type ExtensionMessage =
  | { type: 'YOUTUBE_URL_CHANGED'; url: string }
  | { type: 'GET_PLAYER_RESPONSE'; requestId: string; expectedVideoId: string }
  | { type: 'FETCH_CAPTION'; requestId: string; url: string }
  | { type: 'START_SUMMARY'; request: SummaryRequest }
  | { type: 'CANCEL_SUMMARY'; taskId: string };

console.log('Background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('YouTube AI Summary Extension Installed.');
});

setupAIMessageHandlers();

// Listener for tab updates to notify content script of SPA navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && (tab.url?.includes('youtube.com/watch') || tab.url?.includes('localhost:3000'))) {
    chrome.tabs.sendMessage(tabId, { type: 'YOUTUBE_URL_CHANGED', url: changeInfo.url }).catch(() => {
      // Ignore error if content script isn't ready
    });
  }
});

// The MAIN world injected function. Must not rely on closures.
function fetchPlayerResponseFromMainWorld(): any {
  try {
    const p = (window as any).ytInitialPlayerResponse;
    if (p) {
      // Return a stripped down version to avoid giant objects
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
  if (!sender.tab?.id) return;
  if (sender.frameId !== 0) return; // Only main frame
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
    return true; // Keep channel open for async
  }

  if (message.type === 'FETCH_CAPTION') {
    // Validate URL
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
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      fetch(url.toString(), { signal: controller.signal })
        .then(res => {
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          // Ensure we don't fetch massive non-xml content
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('xml') && !url.hostname.includes('localhost')) {
             throw new Error('Invalid content type');
          }
          return res.text();
        })
        .then(text => {
          if (text.length > 5000000) { // Max 5MB
             throw new Error('Response too large');
          }
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
