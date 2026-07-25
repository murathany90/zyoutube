import { ITranscriptProvider, CaptionTrack, TranscriptResult } from './types';
import { evaluateQuality } from './quality';
import { getPlayerResponseFromMainWorld } from '../content/bridge';

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

  async getAvailableTracks(videoId: string): Promise<CaptionTrack[]> {
    let playerResponse = null;
    let diagnostics = null;
    const maxRetries = 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      playerResponse = await this.getPlayerResponse(videoId);
      
      if (playerResponse?.diagnostics) {
        diagnostics = { ...playerResponse.diagnostics, retryCount: attempt };
      }

      if (playerResponse && !playerResponse.error && playerResponse.videoId === videoId) {
        break; // Success
      }
      
      // If we failed, let's wait 500ms and try again (YouTube SPA might be lazy loading)
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (!playerResponse || playerResponse.error) {
       const { TranscriptError } = await import('./types');
       throw new TranscriptError('PLAYER_RESPONSE_NOT_READY', 'YouTube oynatıcı henüz hazır değil veya veri alınamadı.', diagnostics || {
         expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: false, captionsObjectFound: false, trackCount: 0, trackLanguages: [], retryCount: maxRetries
       });
    }

    if (playerResponse.videoId !== videoId) {
       const { TranscriptError } = await import('./types');
       throw new TranscriptError('PLAYER_RESPONSE_VIDEO_MISMATCH', 'Oynatıcıdaki video ile istenen video eşleşmiyor.', diagnostics || undefined);
    }

    const tracks = playerResponse.captionTracks || [];
    
    if (tracks.length === 0) {
      const { TranscriptError } = await import('./types');
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

  async fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController): Promise<TranscriptResult> {
    const fetchUrl = track.baseUrl + (track.baseUrl.includes('?') ? '&fmt=json3' : '?fmt=json3');
    
    let rawText = '';
    try {
      rawText = await new Promise<string>((resolve, reject) => {
        if (abortController?.signal.aborted) {
          return reject(new Error('Aborted'));
        }
        
        const abortHandler = () => reject(new Error('Aborted'));
        abortController?.signal.addEventListener('abort', abortHandler);

        chrome.runtime.sendMessage(
          { type: 'FETCH_CAPTION', requestId: Math.random().toString(), url: fetchUrl },
          (response) => {
            abortController?.signal.removeEventListener('abort', abortHandler);
            if (chrome.runtime.lastError) {
               reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
               resolve(response.data);
            } else {
               reject(new Error(response?.error || 'Unknown fetch error'));
            }
          }
        );
      });
    } catch (e: any) {
      const { TranscriptError } = await import('./types');
      throw new TranscriptError('CAPTION_FETCH_FAILED', 'Altyazı dosyası indirilemedi.', {
         expectedVideoId: videoId, extractionSource: 'none', playerResponseFound: true, captionsObjectFound: true, trackCount: 1, trackLanguages: [track.languageCode], retryCount: 0, errorCode: e.message
      });
    }

    let segments = [];
    try {
       const { parseTranscript } = await import('./parser');
       segments = parseTranscript(rawText, track.languageCode);
    } catch (e: any) {
       const { TranscriptError } = await import('./types');
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
