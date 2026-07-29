// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { YouTubeTranscriptProvider } from './youtube-provider';
import type { CaptionTrack, TranscriptResult } from './types';

const track: CaptionTrack = {
  baseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=tr&exp=xpe',
  name: { simpleText: 'Turkish' },
  vssId: '.tr',
  languageCode: 'tr',
  isTranslatable: true,
  sourceType: 'automatic'
};

const result: TranscriptResult = {
  videoId: 'video-1',
  videoDurationMs: 1000,
  selectedTrack: track,
  availableTracks: [track],
  segments: [{
    id: 'seg-0',
    sequence: 0,
    startTimeMs: 0,
    endTimeMs: 1000,
    durationMs: 1000,
    text: 'Merhaba',
    cleanText: 'Merhaba',
    languageCode: 'tr'
  }],
  rawSegmentCount: 1,
  cleanSegmentCount: 1,
  coverageRatio: 1,
  quality: null,
  warnings: []
};

describe('YouTubeTranscriptProvider cache', () => {
  it('aynı video, track ve dil için tamamlanmış native sonucu yeniden kullanır', async () => {
    const provider = new YouTubeTranscriptProvider();
    const fetchUncached = vi
      .spyOn(provider as any, 'fetchTranscriptUncached')
      .mockResolvedValue(result);

    await provider.fetchTranscript('video-1', track);
    await provider.fetchTranscript('video-1', track);

    expect(fetchUncached).toHaveBeenCalledTimes(1);
  });

  it('farklı çeviri dillerini ayrı cache anahtarlarında tutar', async () => {
    const provider = new YouTubeTranscriptProvider();
    const fetchUncached = vi
      .spyOn(provider as any, 'fetchTranscriptUncached')
      .mockResolvedValue(result);

    await provider.fetchTranscript('video-1', track, undefined, 'tr');
    await provider.fetchTranscript('video-1', track, undefined, 'en');

    expect(fetchUncached).toHaveBeenCalledTimes(2);
  });
});
