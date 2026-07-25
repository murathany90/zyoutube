export interface TranscriptSegment {
  id: string;
  sequence: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  text: string;
  cleanText: string;
  languageCode: string;
}

export type TranscriptErrorCode =
  | 'PLAYER_RESPONSE_NOT_READY'
  | 'PLAYER_RESPONSE_VIDEO_MISMATCH'
  | 'CAPTION_TRACKS_EMPTY'
  | 'CAPTION_FETCH_FAILED'
  | 'CAPTION_PARSE_FAILED'
  | 'CAPTION_URL_REJECTED'
  | 'CAPTION_RESPONSE_HTML'
  | 'CAPTION_FETCH_TIMEOUT'
  | 'EXTENSION_CONTEXT_INVALIDATED';

export class TranscriptError extends Error {
  constructor(public code: TranscriptErrorCode, message: string, public diagnostics?: TranscriptDiagnostics) {
    super(message);
    this.name = 'TranscriptError';
  }
}

export interface TranscriptDiagnostics {
  expectedVideoId: string;
  detectedVideoId?: string;
  extractionSource:
    | 'movie_player'
    | 'ytd-player'
    | 'watch-flexy'
    | 'ytplayer-config'
    | 'initial-player-response'
    | 'script-fallback'
    | 'transcript-panel'
    | 'none';
  playerResponseFound: boolean;
  captionsObjectFound: boolean;
  trackCount: number;
  trackLanguages: string[];
  retryCount: number;
  errorCode?: string;
}

export interface TranscriptQuality {
  level: 'high' | 'medium' | 'low';
  internalScore: number;
  reasons: string[];
  metrics: {
    coverageRatio: number | null;
    duplicateRatio: number;
    emptyRatio: number;
    invalidSegmentCount: number;
    invalidSegmentRatio: number;
    longGapCount: number;
    longGapsPerHour: number | null;
    soundTagRatio: number;
  };
}

export interface CaptionTrack {
  baseUrl: string;
  name: { simpleText: string };
  vssId: string;
  languageCode: string;
  kind?: string;
  isTranslatable: boolean;
  sourceType: 'manual' | 'automatic' | 'translated' | 'unknown';
}

export interface TranscriptResult {
  videoId: string;
  videoDurationMs: number;
  selectedTrack: CaptionTrack | null;
  availableTracks: CaptionTrack[];
  segments: TranscriptSegment[];
  rawSegmentCount: number;
  cleanSegmentCount: number;
  coverageRatio: number;
  quality: TranscriptQuality | null;
  warnings: string[];
  diagnostics?: TranscriptDiagnostics;
}

export interface ITranscriptProvider {
  getAvailableTracks(videoId: string): Promise<CaptionTrack[]>;
  fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController): Promise<TranscriptResult>;
}
