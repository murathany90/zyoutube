import { ITranscriptProvider, CaptionTrack, TranscriptResult, TranscriptError } from './types';
import { parseTranscript } from './parser';
import { evaluateQuality } from './quality';
import { getPlayerResponseFromMainWorld } from '../content/bridge';
import { RuntimeMessengerError } from '../content/runtime-messenger';

export class YouTubeTranscriptProvider implements ITranscriptProvider {
  
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
          return null; // Stop if it takes too long
        }

        const startIndex = match.index + match[0].length - 1; // points to '{'
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
          if (jsonStr.length > 2000000) continue; // Skip huge objects
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
          // ignore parsing error for this block, try next
        }
      }
    }
    return null;
  }

  private async getPlayerResponse(expectedVideoId: string): Promise<any> {
    try {
      // 1. Try MAIN world bridge first (Preferred Method)
      const bridgeResponse = await getPlayerResponseFromMainWorld(expectedVideoId);
      if (bridgeResponse?.success && bridgeResponse.data && bridgeResponse.data.videoId === expectedVideoId) {
        return bridgeResponse.data;
      }
      
      // If we failed, let's still return the diagnostic data we gathered
      if (bridgeResponse?.data?.diagnostics) {
        return { error: bridgeResponse.error, diagnostics: bridgeResponse.data.diagnostics };
      }

      // 2. Fallback to script tag scanning
      const scripts = document.getElementsByTagName('script');
      let scannedScripts = 0;
      for (let i = 0; i < scripts.length; i++) {
        if (scannedScripts > 20) break; // Don't scan too many scripts
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

  private readonly RETRY_DELAYS = [0, 300, 700, 1200, 2000]; // Bounded backoff ~4.2s total

  private shouldRetry(error: any): boolean {
    if (!error) return true;
    const msg = error.message || '';
    // Never retry these conditions
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

  private validateCaptionUrl(urlStr: string): string {
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

    return url.origin + url.pathname + url.search;
  }

  async fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController): Promise<TranscriptResult> {
    const fetchUrl = track.baseUrl + (track.baseUrl.includes('?') ? '&fmt=json3' : '?fmt=json3');
    let rawText: string;
    try {
      const safeUrl = this.validateCaptionUrl(fetchUrl);

      const response = await fetch(safeUrl, {
        signal: abortController?.signal
      });

      if (!response.ok) {
        throw new TranscriptError('CAPTION_FETCH_FAILED', `Altyazı alınamadı: HTTP ${response.status}`, {
          expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: `HTTP_${response.status}`
        });
      }

      rawText = await response.text();

      if (!rawText || !rawText.trim()) {
        throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı sunucudan boş döndü.', {
          expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'EMPTY_BODY'
        });
      }

      // Body sniffing: reject HTML pages (e.g. login wall, consent page)
      const trimmed = rawText.trim();
      if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
        throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı alınamadı: Sayfa HTML döndürdü.', {
          expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'CAPTION_RESPONSE_HTML'
        });
      }
    } catch (e: any) {
      if (e instanceof TranscriptError) throw e;
      if (e.name === 'AbortError') {
        throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı isteği iptal edildi.', {
          expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'FETCH_ABORTED'
        });
      }
      throw new TranscriptError('CAPTION_FETCH_FAILED', `Altyazı dosyası indirilemedi: ${e.message}`, {
        expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: e.message
      });
    }

    if (!rawText || !rawText.trim()) {
       throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı sunucudan boş döndü. (Video kısıtlaması veya yetki hatası olabilir)', {
         expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: 'EMPTY_BODY'
       });
    }

    let segments = [];
    try {
       console.log('ZYouTube [Transcript] rawText length:', rawText?.length);
       if (rawText?.length < 500) console.log('ZYouTube [Transcript] rawText content (short):', rawText);
       segments = parseTranscript(rawText, track.languageCode);
       console.log('ZYouTube [Transcript] successfully parsed segments count:', segments.length);
    } catch (e: any) {
       console.error('ZYouTube [Transcript] PARSE ERROR:', e.message, e.stack);
       console.error('ZYouTube [Transcript] RAW TEXT DUMP:', rawText ? String(rawText).substring(0, 1000) : 'null/undefined');
       throw new TranscriptError('CAPTION_PARSE_FAILED', 'Altyazı verisi çözümlenemedi veya bozuk. Lütfen konsola bakın.', {
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
