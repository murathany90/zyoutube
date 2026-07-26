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

  private buildCaptionUrl(baseUrl: string, format: string): string {
    // First attempt: return raw URL as-is (preserves PoT/signature)
    if (!format) return baseUrl;
    // Subsequent attempts: set format via URL parsing
    const url = new URL(baseUrl);
    url.searchParams.set('fmt', format);
    return url.toString();
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
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const text = await response.text();
    if (!text || !text.trim()) return null;
    const trimmed = text.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) return null;
    return text;
  }

  private async fetchCaptionViaBackground(track: CaptionTrack, videoId: string, format: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const response = await sendRuntimeMessage<{ type: 'FETCH_CAPTION_FROM_MAIN'; requestId: string; videoId: string; track: CaptionTrack; format: string }, { success: boolean; data?: { rawText: string; format: string }; error?: string; code?: string }>(
        { type: 'FETCH_CAPTION_FROM_MAIN', requestId: Math.random().toString(), videoId, track, format },
        { timeoutMs: 20000, signal }
      );
      if (response?.success && response.data?.rawText) {
        const trimmed = response.data.rawText.trim();
        if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) return null;
        if (!trimmed) return null;
        return response.data.rawText;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async scrapeTranscriptPanel(videoId: string): Promise<TranscriptSegment[] | null> {
    try {
      const response = await sendRuntimeMessage<{ type: 'FETCH_TRANSCRIPT_PANEL'; requestId: string; videoId: string }, { success: boolean; segments?: any[]; error?: string }>(
        { type: 'FETCH_TRANSCRIPT_PANEL', requestId: Math.random().toString(), videoId },
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

  async fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController): Promise<TranscriptResult> {
    let rawText: string | null = null;
    let usedFormat: string | undefined;
    let lastError: string | undefined;
    let panelSegments: TranscriptSegment[] | null = null;

    // Phase 1: First try to scrape native YouTube transcript panel
    console.warn('ZYouTube [Transcript] Trying to scrape native transcript panel...');
    panelSegments = await this.scrapeTranscriptPanel(videoId);
    if (panelSegments && panelSegments.length > 0) {
      usedFormat = 'transcript-panel';
    } else {
      lastError = 'TRANSCRIPT_PANEL_FAILED';
    }

    // Phase 2: If scraping failed, try direct content-script fetch
    if (!usedFormat) {
      console.warn('ZYouTube [Transcript] Native scraping failed, trying direct content-script fetch...');
      for (const fmt of this.FORMATS) {
        try {
          const fetchUrl = this.buildCaptionUrl(track.baseUrl, fmt);
          this.validateCaptionUrl(fetchUrl);
          const result = await this.tryFetchCaption(fetchUrl, abortController?.signal);
          if (result !== null) {
            rawText = result;
            usedFormat = fmt || '(default XML)';
            break;
          }
          lastError = `EMPTY_BODY_${fmt || 'default'}`;
        } catch (e: any) {
          if (e.name === 'AbortError') {
            throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı isteği iptal edildi.', {
              expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'FETCH_ABORTED'
            });
          }
          if (e instanceof TranscriptError) throw e;
          lastError = e.message;
        }
      }
    }

    // Phase 3: Try via background MAIN world
    if (rawText === null && !usedFormat) {
      console.warn('ZYouTube [Transcript] Direct fetch failed, trying MAIN world via background...');
      for (const fmt of this.FORMATS) {
        try {
          const result = await this.fetchCaptionViaBackground(track, videoId, fmt, abortController?.signal);
          if (result !== null) {
            rawText = result;
            usedFormat = `${fmt || '(default XML)'} (MAIN world)`;
            break;
          }
          lastError = `BACKGROUND_EMPTY_BODY_${fmt || 'default'}`;
        } catch (e: any) {
          if (e.name === 'AbortError') {
            throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı isteği iptal edildi.', {
              expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'FETCH_ABORTED'
            });
          }
          if (e instanceof TranscriptError) throw e;
          lastError = `BACKGROUND_ERROR_${fmt || 'default'}: ${e.message}`;
        }
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
       segments = parseTranscript(rawText!, track.languageCode);
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
