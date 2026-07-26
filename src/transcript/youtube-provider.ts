import { ITranscriptProvider, CaptionTrack, TranscriptResult, TranscriptError, TranscriptSegment } from './types';
import { parseTranscript } from './parser';
import { cleanTranscript } from './cleaner';
import { evaluateQuality } from './quality';
import { getPlayerResponseFromMainWorld } from '../content/bridge';
import { RuntimeMessengerError } from '../content/runtime-messenger';
import { sendRuntimeMessage } from '../content/runtime-messenger';

export class YouTubeTranscriptProvider implements ITranscriptProvider {

  private FORMATS = ['', 'json3', 'srv3', 'vtt'];

  private extractJSONFromScript(html: string): any {
    const patterns = [
      /var\s+ytInitialPlayerResponse\s*=\s*({)/g,
      /let\s+ytInitialPlayerResponse\s*=\s*({)/g,
      /window\.ytInitialPlayerResponse\s*=\s*({)/g
    ];

    const MAX_SCRIPT_PARSE_TIME_MS = 50;
    const startTime = performance.now();

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(html)) !== null) {
        if (performance.now() - startTime > MAX_SCRIPT_PARSE_TIME_MS) {
          return null;
        }

        const startIndex = match.index + match[0].length - 1;
        let braceCount = 0;
        let endIndex = startIndex;
        let insideString = false;
        let escape = false;

        for (let i = startIndex; i < html.length; i++) {
          if (performance.now() - startTime > MAX_SCRIPT_PARSE_TIME_MS) return null;

          const char = html[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (char === '\\') {
            escape = true;
            continue;
          }
          if (char === '"' || char === "'") {
            insideString = !insideString;
            continue;
          }
          if (!insideString) {
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;

            if (braceCount === 0) {
              endIndex = i + 1;
              break;
            }
          }
        }

        try {
          const jsonStr = html.substring(startIndex, endIndex);
          if (jsonStr.length > 2000000) continue;
          const parsed = JSON.parse(jsonStr);
          if (parsed && parsed.videoDetails && parsed.videoDetails.videoId) {
            return {
               videoId: parsed.videoDetails.videoId,
               durationMs: parsed.videoDetails.lengthSeconds ? parseInt(parsed.videoDetails.lengthSeconds) * 1000 : null,
               captionTracks: parsed.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((c: any) => ({
                 baseUrl: c.baseUrl,
                 languageCode: c.languageCode,
                 name: c.name?.simpleText || '',
                 kind: c.kind,
                 isTranslatable: c.isTranslatable,
               })) || []
            };
          }
        } catch (e) {
        }
      }
    }
    return null;
  }

  private async getPlayerResponse(expectedVideoId: string): Promise<any> {
    try {
      const bridgeResponse = await getPlayerResponseFromMainWorld(expectedVideoId);
      if (bridgeResponse?.success && bridgeResponse.data && bridgeResponse.data.videoId === expectedVideoId) {
        return bridgeResponse.data;
      }

      if (bridgeResponse?.data?.diagnostics) {
        return { error: bridgeResponse.error, diagnostics: bridgeResponse.data.diagnostics };
      }

      const scripts = document.getElementsByTagName('script');
      let scannedScripts = 0;
      for (let i = 0; i < scripts.length; i++) {
        if (scannedScripts > 20) break;
        const script = scripts[i];
        if (script.innerHTML.includes('ytInitialPlayerResponse')) {
          scannedScripts++;
          const parsed = this.extractJSONFromScript(script.innerHTML);
          if (parsed && parsed.videoId === expectedVideoId) {
            return {
              ...parsed,
              diagnostics: {
                 expectedVideoId,
                 detectedVideoId: expectedVideoId,
                 extractionSource: 'script-fallback',
                 playerResponseFound: true,
                 captionsObjectFound: parsed.captionTracks?.length > 0,
                 trackCount: parsed.captionTracks?.length || 0,
                 trackLanguages: parsed.captionTracks?.map((c: any) => c.languageCode) || [],
                 retryCount: 0,
              }
            };
          }
        }
      }
    } catch (e: any) {
      console.error('Failed to get player response', e);
      return { error: e.message, diagnostics: null };
    }
    return null;
  }

  private readonly RETRY_DELAYS = [0, 300, 700, 1200, 2000];

  private shouldRetry(error: any): boolean {
    if (!error) return true;
    const msg = error.message || '';
    if (msg.includes('Eklenti güncellendi') || msg.includes('invalidated')) return false;
    if (error instanceof RuntimeMessengerError) {
      if (['EXTENSION_CONTEXT_INVALIDATED', 'BACKGROUND_UNAVAILABLE', 'BACKGROUND_TIMEOUT', 'REQUEST_CANCELLED'].includes(error.code)) return false;
    }
    return true;
  }

  async getAvailableTracks(videoId: string): Promise<CaptionTrack[]> {
    let playerResponse = null;
    let diagnostics = null;

    for (let attempt = 0; attempt <= this.RETRY_DELAYS.length; attempt++) {
      if (attempt > 0) {
        const delay = attempt <= this.RETRY_DELAYS.length ? this.RETRY_DELAYS[attempt - 1] : 2000;
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        playerResponse = await this.getPlayerResponse(videoId);
      } catch (e: any) {
        if (!this.shouldRetry(e)) throw e;
        diagnostics = { expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: false, captionsObjectFound: false, trackCount: 0, trackLanguages: [], retryCount: attempt, errorCode: e.code || e.message };
        continue;
      }

      if (playerResponse?.diagnostics) {
        diagnostics = { ...playerResponse.diagnostics, retryCount: attempt };
      }

      if (playerResponse && !playerResponse.error && playerResponse.videoId === videoId) {
        break;
      }

      if (playerResponse?.error?.includes('Eklenti güncellendi') || playerResponse?.error?.includes('invalidated')) {
        throw new TranscriptError('EXTENSION_CONTEXT_INVALIDATED', playerResponse.error, diagnostics || undefined);
      }
    }

    if (!playerResponse || playerResponse.error) {
       throw new TranscriptError('PLAYER_RESPONSE_NOT_READY', 'YouTube oynatıcı henüz hazır değil veya veri alınamadı.', diagnostics || {
         expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: false, captionsObjectFound: false, trackCount: 0, trackLanguages: [], retryCount: this.RETRY_DELAYS.length
       });
    }

    if (playerResponse.videoId !== videoId) {
       throw new TranscriptError('PLAYER_RESPONSE_VIDEO_MISMATCH', 'Oynatıcıdaki video ile istenen video eşleşmiyor.', diagnostics || undefined);
    }

    const tracks = playerResponse.captionTracks || [];

    if (tracks.length === 0) {
      throw new TranscriptError('CAPTION_TRACKS_EMPTY', 'Bu videoda erişilebilir bir altyazı bulunamadı.', diagnostics || undefined);
    }

    return tracks.map((t: any) => {
      let sourceType: CaptionTrack['sourceType'] = 'unknown';
      if (t.kind === 'asr') sourceType = 'automatic';
      else if (t.kind !== 'asr' && t.isTranslatable) sourceType = 'manual';

      if (t.baseUrl && t.baseUrl.includes('kind=asr')) sourceType = 'automatic';

      return {
        baseUrl: t.baseUrl,
        name: t.name,
        vssId: t.vssId,
        languageCode: t.languageCode,
        kind: t.kind,
        isTranslatable: t.isTranslatable,
        sourceType
      };
    });
  }

  private buildCaptionUrl(baseUrl: string, format: string, tlang?: string): string {
    // First attempt: return raw URL as-is (preserves PoT/signature)
    if (!format && !tlang) return baseUrl;
    // Subsequent attempts: append without URL parsing to preserve exact signature encoding
    let finalUrl = baseUrl;
    if (format) finalUrl += `&fmt=${format}`;
    if (tlang) finalUrl += `&tlang=${tlang}`;
    return finalUrl;
  }

  private validateCaptionUrl(urlStr: string): void {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      throw new Error('INVALID_URL');
    }

    const hostname = url.hostname.toLowerCase();
    const isAllowed = hostname === 'www.youtube.com' || hostname === 'youtube.com' ||
      hostname.endsWith('.youtube.com') || hostname === 'googlevideo.com' ||
      hostname.endsWith('.googlevideo.com') || hostname === 'localhost' || hostname === '127.0.0.1';

    if (!isAllowed) {
      throw new Error('HOST_NOT_ALLOWED');
    }

    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && url.protocol !== 'https:') {
      throw new Error('HTTPS_REQUIRED');
    }

    if (url.username || url.password) {
      throw new Error('CREDENTIALS_IN_URL');
    }
  }

  private async tryFetchCaption(url: string, signal?: AbortSignal): Promise<string | null> {
    const response = await fetch(url, { signal, credentials: 'include' });
    if (response.status === 429) {
      throw new Error('HTTP_429_TOO_MANY_REQUESTS');
    }
    if (!response.ok) return null;
    const text = await response.text();
    if (!text || !text.trim()) return null;
    const trimmed = text.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) return null;
    return text;
  }



  private async scrapeTranscriptPanel(videoId: string, tlang?: string, trackLang?: string): Promise<TranscriptSegment[] | null> {
    try {
      const response = await sendRuntimeMessage<{ type: 'FETCH_TRANSCRIPT_PANEL'; requestId: string; videoId: string; tlang?: string; trackLang?: string }, { success: boolean; segments?: any[]; error?: string }>(
        { type: 'FETCH_TRANSCRIPT_PANEL', requestId: Math.random().toString(), videoId, tlang, trackLang },
        { timeoutMs: 25000 }
      );
      if (response?.success && response.segments && response.segments.length > 0) {
        return response.segments.map((s: any, i: number) => ({
          id: `panel-${i}`,
          sequence: i,
          startTimeMs: s.startTimeMs || 0,
          endTimeMs: s.endTimeMs || 0,
          durationMs: s.durationMs || 0,
          text: s.text || '',
          cleanText: s.cleanText || '',
          languageCode: s.languageCode || '',
        }));
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController, tlang?: string): Promise<TranscriptResult> {
    let rawText: string | null = null;
    let usedFormat: string | undefined;
    let lastError: string | undefined;
    let panelSegments: TranscriptSegment[] | null = null;
    let resolvedLanguage = tlang || track.languageCode;

    const requiresPoToken = /(?:[?&])exp=xpe(?:&|$)/.test(track.baseUrl);
    const shouldUseNativePlayer = Boolean(tlang) || requiresPoToken;

    // Phase 1: Native player request capture (for translations or PoToken)
    if (shouldUseNativePlayer) {
      console.warn(`ZYouTube [Transcript] Using Native Caption Body Capture V2 (tlang=${tlang || 'none'}, exp=${requiresPoToken})`);
      try {
        const requestId = Math.random().toString();
        const timeoutMs = 20000;
        
        const capturePromise = new Promise<{ rawText: string; mode?: string }>((resolve, reject) => {
          let timeoutId: number;
          let messageListener: (e: MessageEvent) => void;
          
          const cleanup = () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", messageListener);
          };

          timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error("NATIVE_BODY_CAPTURE_TIMEOUT"));
          }, timeoutMs);

          if (abortController?.signal) {
             abortController.signal.addEventListener('abort', () => {
                cleanup();
                reject(new Error("FETCH_ABORTED"));
             });
          }

          messageListener = (event: MessageEvent) => {
            if (event.source !== window) return;
            const data = event.data;
            if (data && data.source === "zyoutube-main" && data.type === "ZY_CAPTION_CAPTURE_RESULT") {
              if (data.requestId === requestId) {
                cleanup();
                resolve({
                   rawText: data.rawText,
                   mode: tlang ? 'native-player-translation' : 'native-player-original'
                });
              }
            }
          };

          window.addEventListener("message", messageListener);
          
          // Arm the interceptor
          window.postMessage({
            source: "zyoutube-isolated",
            type: "ZY_CAPTION_CAPTURE_ARM",
            requestId,
            videoId,
            sourceLanguage: track.languageCode,
            targetLanguage: tlang,
            expiresAt: Date.now() + timeoutMs
          }, "*");
        });

        // Trigger track change in background
        const triggerResponse = await sendRuntimeMessage<{ type: 'CAPTURE_NATIVE_CAPTION'; requestId: string; videoId: string; sourceLanguage: string; sourceKind?: string; targetLanguage?: string }, { success: boolean; mode?: string; error?: string }>(
          { type: 'CAPTURE_NATIVE_CAPTION', requestId, videoId, sourceLanguage: track.languageCode, sourceKind: track.kind, targetLanguage: tlang },
          { timeoutMs: 25000, signal: abortController?.signal }
        );

        if (!triggerResponse?.success) {
           throw new Error(triggerResponse?.error || 'NATIVE_CAPTURE_TRIGGER_FAILED');
        }

        const captureResult = await capturePromise;
        rawText = captureResult.rawText;
        usedFormat = captureResult.mode;
        resolvedLanguage = tlang || track.languageCode;
      } catch (e: any) {
        if (e.message === 'FETCH_ABORTED' || e.name === 'AbortError') {
          throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı isteği iptal edildi.', { expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'FETCH_ABORTED' });
        }
        lastError = e.message;
        console.warn(`ZYouTube [Transcript] CAPTURE_NATIVE_CAPTION error:`, e);
      }
    }

    // Phase 2: Direct fetch (only for non-protected, non-translated original tracks)
    if (rawText === null && !requiresPoToken && !tlang) {
      console.warn('ZYouTube [Transcript] Trying direct content-script fetch (API)...');
      for (const fmt of this.FORMATS) {
        try {
          const fetchUrl = this.buildCaptionUrl(track.baseUrl, fmt, tlang);
          this.validateCaptionUrl(fetchUrl);
          const result = await this.tryFetchCaption(fetchUrl, abortController?.signal);
          if (result !== null) {
            rawText = result;
            usedFormat = fmt || '(default XML)';
            resolvedLanguage = track.languageCode;
            break;
          }
          lastError = `EMPTY_BODY_${fmt || 'default'}`;
        } catch (e: any) {
          if (e.name === 'AbortError') {
            throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı isteği iptal edildi.', { expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'FETCH_ABORTED' });
          }
          if (e.message === 'HTTP_429_TOO_MANY_REQUESTS') {
            console.warn('ZYouTube [Transcript] API rate limited (429), skipping further direct fetches.');
            lastError = 'HTTP_429_TOO_MANY_REQUESTS';
            break;
          }
          lastError = e.message;
        }
      }
    }

    // Phase 3: Fallback to scraping native YouTube transcript panel (only for original track)
    if (rawText === null && !usedFormat) {
      console.warn(`ZYouTube [Transcript] API fetches failed, falling back to native transcript panel scraping (tlang ignored for scraper)`);
      try {
        const segments = await this.scrapeTranscriptPanel(videoId);
        if (segments && segments.length > 0) {
          // If translation was requested, we MUST NOT return the original scraper results as "success"
          if (tlang && tlang !== track.languageCode) {
            console.warn('ZYouTube [Transcript] Scraper returned original language, but translation was requested. Throwing TRANSLATION_UNAVAILABLE.');
            lastError = 'TRANSLATION_UNAVAILABLE';
          } else {
            panelSegments = segments;
            usedFormat = 'transcript-panel';
            resolvedLanguage = track.languageCode;
            lastError = '';
          }
        } else {
          lastError = 'TRANSCRIPT_PANEL_FAILED';
        }
      } catch (e: any) {
        console.warn('ZYouTube [Transcript] Fallback scrape failed:', e);
        lastError = 'TRANSCRIPT_PANEL_FAILED';
      }
    }

    if (rawText === null && !usedFormat) {
      console.warn('ZYouTube [Transcript] All caption fetch methods failed. Last error:', lastError);
      throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı alınamadı: Sunucu boş veya geçersiz yanıt döndürdü.', {
        expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: lastError || 'ALL_FORMATS_FAILED'
      });
    }

    // If panel scraping succeeded, return segments directly without parse
    if (usedFormat === 'transcript-panel') {
      const rawSegments = cleanTranscript(panelSegments!);
      const playerResponse = await this.getPlayerResponse(videoId);
      const videoDurationMs = playerResponse?.durationMs || 0;
      const quality = evaluateQuality(rawSegments, track, videoDurationMs);
      return {
        videoId,
        videoDurationMs,
        selectedTrack: track,
        availableTracks: [track],
        segments: rawSegments,
        rawSegmentCount: rawSegments.length,
        cleanSegmentCount: rawSegments.length,
        coverageRatio: quality.metrics.coverageRatio || 0,
        quality,
        warnings: quality.reasons
      };
    }

    let segments: TranscriptSegment[] = [];
    try {
       segments = parseTranscript(rawText!, resolvedLanguage);
    } catch (e: any) {
       throw new TranscriptError('CAPTION_PARSE_FAILED', 'Altyazı verisi çözümlenemedi veya bozuk.', {
         expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: e.message
       });
    }

    const playerResponse = await this.getPlayerResponse(videoId);
    if (!playerResponse || playerResponse.videoId !== videoId) {
       throw new Error('Video has changed, aborting transcript generation');
    }

    const videoDurationMs = playerResponse.durationMs || 0;
    const rawSegmentCount = segments.length;
    const quality = evaluateQuality(segments, track, videoDurationMs);

    return {
      videoId,
      videoDurationMs,
      selectedTrack: track,
      availableTracks: [track],
      segments,
      rawSegmentCount,
      cleanSegmentCount: segments.length,
      coverageRatio: quality.metrics.coverageRatio || 0,
      quality,
      warnings: quality.reasons
    };
  }
}
