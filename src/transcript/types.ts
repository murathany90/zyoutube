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
}

export interface ITranscriptProvider {
  getAvailableTracks(videoId: string): Promise<CaptionTrack[]>;
  fetchTranscript(videoId: string, track: CaptionTrack, abortController?: AbortController): Promise<TranscriptResult>;
}
