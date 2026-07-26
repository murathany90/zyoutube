import { SummaryRequest } from '../ai/types';
import { AITaskManager } from '../ai/task-manager';
import { GemSettingsService } from '../gem/settings';
import { captureNativeYouTubeCaption } from './native-caption-broker';
import { setupOffscreenDocument } from './offscreen-manager';
import { AISettingsService } from '../settings/ai-settings';

export type ExtensionMessage =
  | { type: 'YOUTUBE_URL_CHANGED'; url: string }
  | { type: 'GET_PLAYER_RESPONSE'; requestId: string; expectedVideoId: string }
  | { type: 'FETCH_CAPTION'; requestId: string; videoId: string; track: { baseUrl: string; languageCode: string; kind?: string }; format: 'json3' | 'xml' }
  | { type: 'FETCH_CAPTION_FROM_MAIN'; requestId: string; videoId: string; track: CaptionTrackMessage; format: string }
  | { type: 'FETCH_TRANSCRIPT_PANEL'; requestId: string; videoId: string; tlang?: string; trackLang?: string }
  | { type: 'CAPTURE_NATIVE_CAPTION'; requestId: string; videoId: string; sourceLanguage: string; sourceKind?: string; targetLanguage?: string }
  | { type: 'START_SUMMARY'; request: SummaryRequest }
  | { type: 'CANCEL_SUMMARY'; taskId: string }
  | { type: 'GET_PANEL_SETTINGS' }
  | { type: 'GET_GEM_SETTINGS' }
  | { type: 'PANEL_SETTINGS_CHANGED' }
  | { type: 'COPY_TO_CLIPBOARD'; text: string }
  | { type: 'PING_BACKGROUND' }
  | { type: 'TEST_CONNECTION'; providerId: any }
  | { type: 'API_SUMMARY_START'; taskId: string; videoId: string; request: any; config: any }
  | { type: 'API_SUMMARY_PROGRESS'; taskId: string; videoId: string; message: string; progress: number }
  | { type: 'API_SUMMARY_COMPLETED'; taskId: string; videoId: string; result: any }
  | { type: 'API_SUMMARY_FAILED'; taskId: string; videoId: string; error: any }
  | { type: 'API_SUMMARY_CANCEL'; taskId: string; videoId: string }
  | { type: 'API_SUMMARY_HEARTBEAT'; taskId: string; videoId: string };

interface CaptionTrackMessage {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
  name?: { simpleText: string };
  vssId?: string;
  sourceType?: string;
}

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

      if (request.engine === 'openai-compatible') {
        const taskState = {
          taskId: request.taskId,
          tabId,
          videoId: request.video.videoId,
          status: 'preparing',
          startedAt: Date.now(),
          lastHeartbeatAt: Date.now()
        };
        chrome.storage.session.set({ [`api_task_${request.taskId}`]: taskState }).catch(console.error);

        AISettingsService.getProviderConfig('openai-compatible').then(config => {
          return setupOffscreenDocument().then(() => config);
        }).then(config => {
          chrome.runtime.sendMessage({
            type: 'API_SUMMARY_START',
            taskId: request.taskId,
            videoId: request.video.videoId,
            request,
            config
          }).catch(console.error);
        }).catch(console.error);

        sendResponse({ success: true, taskId: request.taskId, accepted: true });
        return true;
      }

      AITaskManager.startTask(request, tabId, (status, msg, progress) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_PROGRESS',
          taskId: request.taskId,
          status,
          message: msg,
          progress
        }).catch((e) => {
          console.error(`[AITaskManager] delivery failed for task ${request.taskId}:`, e);
        });
      }).then((result) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_COMPLETED',
          taskId: request.taskId,
          result
        }).catch((e) => {
          console.error(`[AITaskManager] delivery failed for task ${request.taskId}:`, e);
        });
      }).catch((error) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'SUMMARY_FAILED',
          taskId: request.taskId,
          error: {
            code: error.code || 'UNKNOWN_ERROR',
            userMessage: error.userMessage || error.message || 'Bir hata oluştu.',
            retryable: error.retryable ?? true
          }
        }).catch((e) => {
          console.error(`[AITaskManager] delivery failed for task ${request.taskId}:`, e);
        });
      });

      sendResponse({ success: true });
      return true;
    }

    // 4. CANCEL_SUMMARY - requires tab context
    if (message.type === 'CANCEL_SUMMARY') {
      const { taskId } = message;
      
      // Try offscreen first
      chrome.storage.session.get(`api_task_${taskId}`).then((data) => {
        if (data[`api_task_${taskId}`]) {
          chrome.runtime.sendMessage({ type: 'API_SUMMARY_CANCEL', taskId, videoId: '' }).catch(console.error);
          chrome.storage.session.remove(`api_task_${taskId}`).catch(console.error);
        }
      });
      
      AITaskManager.cancelTask(taskId).catch(console.error);
      sendResponse({ success: true });
      return true;
    }

    // 5. API_SUMMARY_* Relay
    if (message.type.startsWith('API_SUMMARY_') && message.type !== 'API_SUMMARY_START' && message.type !== 'API_SUMMARY_CANCEL') {
      chrome.storage.session.get(`api_task_${(message as any).taskId}`).then((data) => {
        const taskState = data[`api_task_${(message as any).taskId}`];
        if (taskState && taskState.tabId) {
           if (message.type === 'API_SUMMARY_HEARTBEAT') {
              chrome.storage.session.set({ 
                  [`api_task_${(message as any).taskId}`]: { ...taskState, lastHeartbeatAt: Date.now() } 
              }).catch(console.error);
              
              chrome.tabs.sendMessage(taskState.tabId, {
                  type: 'API_SUMMARY_HEARTBEAT',
                  taskId: (message as any).taskId
              }).catch(e => {
                  console.error(`[API Task] delivery failed for task ${(message as any).taskId}:`, e);
              });
           } else if (message.type === 'API_SUMMARY_COMPLETED') {
              chrome.storage.session.remove(`api_task_${(message as any).taskId}`).catch(console.error);
              chrome.tabs.sendMessage(taskState.tabId, {
                  type: 'SUMMARY_COMPLETED',
                  taskId: (message as any).taskId,
                  result: (message as any).result
              }).catch(e => {
                  console.error(`[API Task] delivery failed for task ${(message as any).taskId}:`, e);
              });
           } else if (message.type === 'API_SUMMARY_FAILED') {
              chrome.storage.session.remove(`api_task_${(message as any).taskId}`).catch(console.error);
              chrome.tabs.sendMessage(taskState.tabId, {
                  type: 'SUMMARY_FAILED',
                  taskId: (message as any).taskId,
                  error: (message as any).error
              }).catch(e => {
                  console.error(`[API Task] delivery failed for task ${(message as any).taskId}:`, e);
              });
           } else if (message.type === 'API_SUMMARY_PROGRESS') {
              chrome.tabs.sendMessage(taskState.tabId, {
                  type: 'SUMMARY_PROGRESS',
                  taskId: (message as any).taskId,
                  status: 'summarizing',
                  message: (message as any).message,
                  progress: (message as any).progress
              }).catch(e => {
                  console.error(`[API Task] delivery failed for task ${(message as any).taskId}:`, e);
              });
           }
        }
      });
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

    // 9. FETCH_CAPTION_FROM_MAIN - uses chrome.scripting.executeScript in MAIN world
    if (message.type === 'FETCH_CAPTION_FROM_MAIN') {
      handleFetchCaptionFromMain(message, sendResponse, sender);
      return true;
    }

    // 10. FETCH_TRANSCRIPT_PANEL - scrape YouTube's visible transcript panel via MAIN world
    if (message.type === 'FETCH_TRANSCRIPT_PANEL') {
      handleTranscriptPanel(message, sendResponse, sender);
      return true;
    }

    // 11. CAPTURE_NATIVE_CAPTION - intercept native timedtext request
    if (message.type === 'CAPTURE_NATIVE_CAPTION') {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ success: false, error: 'NO_TAB' });
        return true;
      }
      captureNativeYouTubeCaption(tabId, {
        videoId: message.videoId,
        sourceLanguage: message.sourceLanguage,
        sourceKind: message.sourceKind,
        targetLanguage: message.targetLanguage
      }).then(sendResponse).catch(e => {
        sendResponse({ success: false, error: e.message || 'NATIVE_CAPTURE_FAILED' });
      });
      return true;
    }

    // Unknown message type
    console.warn(`[Background] Unknown message type:`, (message as any).type);
    sendResponse({ success: false, error: 'Unknown message type' });
    return true;
  });
}

function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

const CAPTION_ALLOWED_HOSTS = ['youtube.com', 'googlevideo.com'];
const CAPTION_FETCH_TIMEOUT_MS = 15000;
const MAX_CAPTION_BODY_BYTES = 5 * 1024 * 1024;

function handleFetchCaption(message: any, sendResponse: (response: any) => void) {
  const { videoId, track, format, requestId } = message;

  if (!videoId || !track?.baseUrl) {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'MISSING_FIELDS' });
    return;
  }

  let url: URL;
  try {
    url = new URL(track.baseUrl);
  } catch {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'INVALID_URL' });
    return;
  }

  const hostname = url.hostname.toLowerCase();
  const isAllowedHost = CAPTION_ALLOWED_HOSTS.some(d => hostnameMatches(hostname, d));
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (!isLocalhost && !isAllowedHost) {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'HOST_NOT_ALLOWED', host: hostname });
    return;
  }

  if (!isLocalhost && url.protocol !== 'https:') {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'HTTPS_REQUIRED' });
    return;
  }

  if (url.username || url.password) {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'CREDENTIALS_IN_URL' });
    return;
  }

  const isTimedtextEndpoint = url.pathname.includes('timedtext') || hostname === 'www.youtube.com';
  if (!isLocalhost && !isTimedtextEndpoint) {
    sendResponse({ success: false, error: 'CAPTION_URL_REJECTED', code: 'INVALID_PATH', path: url.pathname });
    return;
  }

  // Build fetch URL with requested format
  const fetchUrlStr = track.baseUrl + (track.baseUrl.includes('?') ? `&fmt=${format}` : `?fmt=${format}`);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), CAPTION_FETCH_TIMEOUT_MS);

  fetch(fetchUrlStr, { signal: abortController.signal })
    .then(async (response) => {
      clearTimeout(timeoutId);

      if (!response.ok) {
        sendResponse({ success: false, error: `CAPTION_FETCH_HTTP_ERROR`, code: `HTTP_${response.status}` });
        return;
      }

      const contentType = response.headers.get('content-type') || '';

      // Reject HTML
      if (contentType.includes('text/html') || contentType.includes('text/html')) {
        sendResponse({ success: false, error: 'CAPTION_RESPONSE_HTML', code: 'HTML_REJECTED' });
        return;
      }

      // Reject too-large response
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_CAPTION_BODY_BYTES) {
        sendResponse({ success: false, error: 'CAPTION_FETCH_FAILED', code: 'RESPONSE_TOO_LARGE' });
        return;
      }

      const rawText = await response.text();

      if (!rawText || !rawText.trim()) {
        sendResponse({ success: false, error: 'CAPTION_FETCH_FAILED', code: 'EMPTY_BODY' });
        return;
      }

      // Body sniffing: reject HTML pages even without content-type header
      const trimmed = rawText.trim();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
        sendResponse({ success: false, error: 'CAPTION_RESPONSE_HTML', code: 'HTML_SNIFFED' });
        return;
      }

      sendResponse({
        success: true,
        data: {
          rawText,
          format,
          requestId
        }
      });
    })
    .catch((e: any) => {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        sendResponse({ success: false, error: 'CAPTION_FETCH_TIMEOUT', code: 'TIMEOUT' });
      } else {
        sendResponse({ success: false, error: 'CAPTION_FETCH_FAILED', code: e.message });
      }
    });
}

function buildCaptionUrl(baseUrl: string, format: string, tlang?: string): string {
  let finalUrl = baseUrl;
  if (format) {
    finalUrl += `&fmt=${format}`;
  }
  if (tlang) {
    finalUrl += `&tlang=${tlang}`;
  }
  return finalUrl;
}

async function fetchCaptionFromMainWorldInjected(captionUrl: string, format: string, tlang?: string): Promise<{ success: boolean; data?: string; error?: string; httpStatus?: number; contentType?: string; bodyLength?: number }> {
  const fetchUrl = buildCaptionUrl(captionUrl, format, tlang);
  try {
    const response = await fetch(fetchUrl, { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';
    const httpStatus = response.status;
    if (!response.ok) {
      return { success: false, error: `HTTP_${response.status}`, httpStatus, contentType, bodyLength: 0 };
    }
    const text = await response.text();
    const bodyLength = text ? text.length : 0;
    if (!text || !text.trim()) {
      return { success: false, error: 'EMPTY_BODY', httpStatus, contentType, bodyLength };
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
      return { success: false, error: 'HTML_RESPONSE', httpStatus, contentType, bodyLength };
    }
    return { success: true, data: text, httpStatus, contentType, bodyLength };
  } catch (e: any) {
    return { success: false, error: e.message || 'FETCH_ERROR', httpStatus: 0, contentType: '', bodyLength: 0 };
  }
}

async function scrapeTranscriptPanelInjected(hideNativeTranscript: boolean = true, tlang?: string | null, trackLang?: string | null): Promise<{ success: boolean; segments?: Array<{ startTimeMs: number; endTimeMs: number; durationMs: number; text: string; languageCode: string }>; error?: string }> {
  const _log: string[] = [];
  const _w = (m: string) => { _log.push(m); console.log('ZYouTube Scrape:', m); };

  const getSegments = () => {
    let cues = document.querySelectorAll('transcript-segment-view-model, ytd-transcript-segment-renderer');
    return Array.from(cues).filter(cue => {
      const el = cue as HTMLElement;
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  };

  try {
    _w('Starting scraping...');
    let weOpenedIt = false;

    // Step 1: Read already open native segments
    let segmentsNodes = getSegments();
    
    // If tlang or trackLang is provided and panel is already open, close it so we can re-open it to apply language
    if (segmentsNodes.length > 0 && (tlang || trackLang)) {
      _w('Panel already open. Closing panel to force refresh or change language...');
      const closeBtn = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] button[aria-label*="Close" i], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] button[aria-label*="kapat" i]');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        await new Promise(r => setTimeout(r, 800));
        segmentsNodes = getSegments(); // Should be empty now
      }
    }

    if (segmentsNodes.length > 0) {
      _w('Segments already open, skipping click.');
    } else {
      weOpenedIt = true;
      // Step 2: Click Native "Show transcript" button
      _w('Step 2: Looking for native transcript button...');

      // We might need to expand description first
      const expandBtn = document.querySelector('tp-yt-paper-button#expand, ytd-text-inline-expander tp-yt-paper-button, #expand-sizer');
      let descriptionWasExpanded = true;
      if (expandBtn && expandBtn.closest('ytd-text-inline-expander')?.hasAttribute('is-collapsed')) {
        descriptionWasExpanded = false;
        (expandBtn as HTMLElement).click();
        _w('Expanded description');
        await new Promise(r => setTimeout(r, 1000));
      }

      // Search for the button
      const searchAreas = document.querySelectorAll('ytd-video-description-transcript-section-renderer, #structured-description, ytd-watch-metadata, ytd-menu-popup-renderer');
      let transcriptBtn: HTMLElement | null = null;

      for (const area of Array.from(searchAreas)) {
        const btns = area.querySelectorAll('button, tp-yt-paper-button, yt-button-shape, .yt-spec-button-shape-next');
        for (const btn of Array.from(btns)) {
          const text = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
          if (text.includes('transkripti göster') || text.includes('show transcript') || (text.includes('transcript') && !text.includes('search')) || (text.includes('transkript') && !text.includes('ara'))) {
            transcriptBtn = btn as HTMLElement;
            break;
          }
        }
        if (transcriptBtn) break;
      }

      // If not found, try to open the More Actions (...) menu
      if (!transcriptBtn) {
        _w('Transcript button not found in description, trying More Actions menu...');
        const moreBtn = document.querySelector('ytd-menu-renderer yt-button-shape#button-shape button');
        if (moreBtn) {
          (moreBtn as HTMLElement).click();
          await new Promise(r => setTimeout(r, 500));
          
          const popupAreas = document.querySelectorAll('ytd-menu-popup-renderer');
          for (const area of Array.from(popupAreas)) {
            const items = area.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item, button, .yt-spec-button-shape-next');
            for (const item of Array.from(items)) {
              const text = (item.textContent || item.getAttribute('aria-label') || '').trim().toLowerCase();
              if (text.includes('transkripti göster') || text.includes('show transcript') || (text.includes('transcript') && !text.includes('search')) || (text.includes('transkript') && !text.includes('ara'))) {
                transcriptBtn = item as HTMLElement;
                break;
              }
            }
            if (transcriptBtn) break;
          }
        }
      }

      if (transcriptBtn) {
        const actualBtn = transcriptBtn.querySelector('button') || transcriptBtn;
        _w(`Found native transcript button: ${transcriptBtn.tagName} / ${transcriptBtn.className}, clicking: ${actualBtn.tagName}`);
        actualBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 200)); // give it a moment to scroll
        actualBtn.click();
        
        // Also dispatch a mousedown/mouseup to be safe for polymer
        actualBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        actualBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));

        // Wait for segments
        let waitTime = 0;
        while (waitTime < 10000) {
          await new Promise(r => setTimeout(r, 500));
          waitTime += 500;

          // Check for PAyouchat and reject/close
          const youchat = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="PAyouchat"], ytd-engagement-panel-section-list-renderer[target-id="PAask"]');
          if (youchat && youchat.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
            _w('Rejected PAyouchat/PAask panel');
            // Try to close it
            const closeBtn = youchat.querySelector('button[aria-label="Close"], #close-button button, .yt-spec-button-shape-next[aria-label*="Close"]');
            if (closeBtn) (closeBtn as HTMLElement).click();
          }

          segmentsNodes = getSegments();
          if (segmentsNodes.length > 0) {
            _w(`Found ${segmentsNodes.length} segments`);
            break;
          }
        }
      } else {
         _w('Native transcript button not found in description');
      }      // Revert description expansion if we expanded it
      if (descriptionWasExpanded) {
        const collapseBtn = document.querySelector('tp-yt-paper-button#collapse');
        if (collapseBtn) {
          (collapseBtn as HTMLElement).click();
          _w('Collapsed description');
        }
      }
    }

    // Step 3: Scroll to load all lazy-loaded segments
    _w('Step 3: Scrolling to load all segments...');
    const scroller = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #content, ytd-transcript-search-panel-renderer #content, #segments-container, ytd-transcript-segment-list-renderer');
    
    if (scroller) {
      let lastHeight = 0;
      let noChangeCount = 0;
      // Scroll down repeatedly until the height stops increasing (meaning all items loaded)
      while (noChangeCount < 5) {
        scroller.scrollTop = scroller.scrollHeight;
        // Also dispatch a wheel event just in case it's needed
        scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000, bubbles: true }));
        await new Promise(r => setTimeout(r, 250)); // wait for DOM to update
        
        if (scroller.scrollHeight === lastHeight) {
          noChangeCount++;
        } else {
          lastHeight = scroller.scrollHeight;
          noChangeCount = 0;
        }
      }
      _w('Finished scrolling.');
    } else {
      _w('Scroller container not found, skipping auto-scroll.');
    }

    // Now get all segments that have been rendered
    segmentsNodes = getSegments();

    if (segmentsNodes.length === 0) {
      _w('TRANSCRIPT_PANEL_FALLBACK_FAILED');
      (window as any).__zyoutube_scrape_log__ = _log;
      return { success: false, error: 'NO_SEGMENTS' };
    }

    _w('Step 4: Extracting language...');
    const langEl = document.querySelector('.language-option, #language-menu, ytd-transcript-renderer #header, .ytd-transcript-renderer #header');
    const languageCode = langEl?.textContent?.trim() || 'unknown';

    _w(`Step 5: Extracting ${segmentsNodes.length} segments...`);
    const segments: Array<{ startTimeMs: number; endTimeMs: number; durationMs: number; text: string; languageCode: string }> = [];

    segmentsNodes.forEach((cue, index) => {
      const timeEl = cue.querySelector('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, .timestamp, .time, [role="button"], #timestamp');
      const textEl = cue.querySelector('.segment-text, .ytAttributedStringHost, .text, .segment, #text, yt-formatted-string');

      let startTimeMs = 0;
      if (timeEl) {
        const timeStr = timeEl.textContent?.trim() || '';
        const parts = timeStr.split(':');
        if (parts.length === 2) {
          startTimeMs = (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000;
        } else if (parts.length === 3) {
          startTimeMs = (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])) * 1000;
        }
      }

      let text = '';
      if (textEl) {
        text = textEl.textContent?.trim() || '';
      }
      if (!text) {
        text = cue.textContent?.replace(/[0-9:]+/g, '').trim() || '';
      }

      let endTimeMs = startTimeMs + 2000;
      if (index < segmentsNodes.length - 1) {
        const nextTimeEl = segmentsNodes[index + 1].querySelector('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, .timestamp, .time, [role="button"], #timestamp');
        if (nextTimeEl) {
          const nextTimeStr = nextTimeEl.textContent?.trim() || '';
          const nextParts = nextTimeStr.split(':');
          let nextStartMs = 0;
          if (nextParts.length === 2) {
            nextStartMs = (parseInt(nextParts[0]) * 60 + parseFloat(nextParts[1])) * 1000;
          } else if (nextParts.length === 3) {
            nextStartMs = (parseInt(nextParts[0]) * 3600 + parseInt(nextParts[1]) * 60 + parseFloat(nextParts[2])) * 1000;
          }
          if (nextStartMs > startTimeMs) endTimeMs = nextStartMs;
        }
      }

      const durationMs = endTimeMs - startTimeMs;
      if (text) {
        segments.push({ startTimeMs, endTimeMs, durationMs, text, languageCode });
      }
    });

    _w(`Extracted ${segments.length} non-empty segments`);

    if (hideNativeTranscript && weOpenedIt) {
      _w('Closing native transcript panel...');
      const closeBtn = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] button[aria-label*="Close" i], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] button[aria-label*="kapat" i]');
      if (closeBtn) {
        (closeBtn as HTMLElement).click();
        _w('Closed native panel.');
      }
    }

    if (segments.length === 0) {
      (window as any).__zyoutube_scrape_log__ = _log;
      return { success: false, error: 'NO_SEGMENTS' };
    }

    (window as any).__zyoutube_scrape_log__ = _log;
    return { success: true, segments };
  } catch (e: any) {
    (window as any).__zyoutube_scrape_log__ = _log;
    return { success: false, error: e.message || 'SCRAPE_ERROR' };
  }
}

function handleFetchCaptionFromMain(message: any, sendResponse: (response: any) => void, sender: chrome.runtime.MessageSender) {
  const { track, format, tlang } = message;
  if (!track?.baseUrl) {
    sendResponse({ success: false, error: 'MISSING_FIELDS' });
    return;
  }

  let url: URL;
  try {
    url = new URL(track.baseUrl);
  } catch {
    sendResponse({ success: false, error: 'INVALID_URL' });
    return;
  }

  const hostname = url.hostname.toLowerCase();
  const isAllowed = hostname === 'www.youtube.com' || hostname === 'youtube.com' ||
    hostname.endsWith('.youtube.com') || hostname === 'googlevideo.com' ||
    hostname.endsWith('.googlevideo.com') || hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isAllowed) {
    sendResponse({ success: false, error: 'HOST_NOT_ALLOWED', code: 'HOST_NOT_ALLOWED', host: hostname });
    return;
  }

  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && url.protocol !== 'https:') {
    sendResponse({ success: false, error: 'HTTPS_REQUIRED', code: 'HTTPS_REQUIRED' });
    return;
  }

  if (url.username || url.password) {
    sendResponse({ success: false, error: 'CREDENTIALS_IN_URL', code: 'CREDENTIALS_IN_URL' });
    return;
  }

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, error: 'NO_TAB', code: 'NO_TAB' });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: 'MAIN',
    func: fetchCaptionFromMainWorldInjected,
    args: [track.baseUrl, format, tlang || null]
  }).then(results => {
    const result = results[0]?.result;
    if (result?.success && result.data) {
      sendResponse({
        success: true,
        data: {
          rawText: result.data,
          format,
          httpStatus: result.httpStatus,
          contentType: result.contentType,
          bodyLength: result.bodyLength,
        }
      });
    } else {
      sendResponse({
        success: false,
        error: result?.error || 'FETCH_FAILED',
        data: {
          httpStatus: result?.httpStatus,
          contentType: result?.contentType,
          bodyLength: result?.bodyLength,
        }
      });
    }
  }).catch(e => {
    sendResponse({ success: false, error: e.message || 'EXECUTE_SCRIPT_FAILED' });
  });
}

function handleTranscriptPanel(_message: any, sendResponse: (response: any) => void, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, error: 'NO_TAB' });
    return;
  }
  
  const { tlang, trackLang } = _message;

  chrome.storage.local.get('panel_settings').then(data => {
    const hideNative = data.panel_settings?.hideNativeTranscript ?? true;

    chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'MAIN',
      func: scrapeTranscriptPanelInjected,
      args: [hideNative, tlang || null, trackLang || null]
    }).then(results => {
      const result = results[0]?.result;
      if (result?.success && result.segments) {
        sendResponse({ success: true, segments: result.segments });
      } else {
        sendResponse({ success: false, error: result?.error || 'SCRAPE_FAILED' });
      }
    }).catch(e => {
      sendResponse({ success: false, error: e.message || 'EXECUTE_SCRIPT_FAILED' });
    });
  }).catch(e => {
    sendResponse({ success: false, error: e.message || 'STORAGE_READ_FAILED' });
  });
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
