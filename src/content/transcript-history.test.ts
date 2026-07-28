import { describe, expect, it, vi } from 'vitest';
import { persistDisplayedTranscript } from './transcript-history';
import type { TranscriptResult } from '../transcript/types';

function transcriptResult(): TranscriptResult {
  return {
    videoId: 'video-1',
    videoDurationMs: 1000,
    selectedTrack: {
      baseUrl: 'https://www.youtube.com/api/timedtext',
      name: { simpleText: 'English' },
      vssId: '.en',
      languageCode: 'en',
      isTranslatable: true,
      sourceType: 'automatic'
    },
    availableTracks: [],
    segments: [{
      id: 's1',
      sequence: 1,
      startTimeMs: 0,
      endTimeMs: 1000,
      durationMs: 1000,
      text: 'Hello',
      cleanText: 'Hello',
      secondaryText: 'Merhaba',
      languageCode: 'en'
    }],
    rawSegmentCount: 1,
    cleanSegmentCount: 1,
    coverageRatio: 1,
    quality: null,
    warnings: []
  };
}

describe('persistDisplayedTranscript', () => {
  it('panel title/url and displayed track metadata are saved before library update', async () => {
    const calls: string[] = [];
    const saveTranscript = vi.fn(async () => {
      calls.push('save');
    });
    const notifyLibrary = vi.fn(async () => {
      calls.push('notify');
    });

    const persisted = await persistDisplayedTranscript({
      videoId: 'video-1',
      title: 'Gerçek video başlığı',
      url: 'https://www.youtube.com/watch?v=video-1',
      result: transcriptResult(),
      displayedLanguage: 'both'
    }, {
      saveTranscript,
      notifyLibrary
    });

    expect(persisted).toBe(true);
    expect(saveTranscript).toHaveBeenCalledWith(
      {
        videoId: 'video-1',
        title: 'Gerçek video başlığı',
        url: 'https://www.youtube.com/watch?v=video-1'
      },
      transcriptResult().segments,
      {
        languageCode: 'en',
        trackLanguage: 'en',
        sourceType: 'automatic',
        displayedLanguage: 'both'
      }
    );
    expect(notifyLibrary).toHaveBeenCalledWith({
      type: 'LIBRARY_ENTRY_UPDATED',
      videoId: 'video-1',
      reason: 'transcript'
    });
    expect(calls).toEqual(['save', 'notify']);
  });

  it('empty transcript is not persisted or announced', async () => {
    const emptyResult = transcriptResult();
    emptyResult.segments = [];
    const saveTranscript = vi.fn();
    const notifyLibrary = vi.fn();

    await expect(persistDisplayedTranscript({
      videoId: 'video-1',
      title: 'Video',
      url: 'https://www.youtube.com/watch?v=video-1',
      result: emptyResult,
      displayedLanguage: 'tr'
    }, {
      saveTranscript,
      notifyLibrary
    })).resolves.toBe(false);

    expect(saveTranscript).not.toHaveBeenCalled();
    expect(notifyLibrary).not.toHaveBeenCalled();
  });
});
