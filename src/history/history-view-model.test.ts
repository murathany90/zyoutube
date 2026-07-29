import { describe, expect, it } from 'vitest';
import {
  getHistoryInitialTab,
  getOriginalTranscriptData,
  shouldShowSummaryEmptyState
} from './history-view-model';
import type { VideoLibraryEntry } from './library-service';

function transcriptOnlyEntry(): VideoLibraryEntry {
  return {
    videoId: 'video-1',
    title: 'Transcript Video',
    url: 'https://www.youtube.com/watch?v=video-1',
    createdAt: 100,
    updatedAt: 100,
    savedSummary: {
      id: 'transcript_video-1',
      videoId: 'video-1',
      title: 'Transcript Video',
      url: 'https://www.youtube.com/watch?v=video-1',
      date: 100,
      transcript: [{
        id: 's1',
        sequence: 1,
        startTimeMs: 0,
        endTimeMs: 1000,
        durationMs: 1000,
        text: 'Merhaba',
        cleanText: 'Merhaba',
        secondaryText: 'Hello',
        languageCode: 'tr'
      }]
    },
    studyWordCount: 0,
    hasSummary: false,
    hasOriginalTranscript: true,
    hasCorrectedTranscript: false,
    hasStudyWords: false
  };
}

describe('history transcript-only view model', () => {
  it('summary remains the initial tab and renders the empty summary state', () => {
    const entry = transcriptOnlyEntry();

    expect(getHistoryInitialTab(entry, '')).toBe('summary');
    expect(shouldShowSummaryEmptyState(entry, 'summary')).toBe(true);
  });

  it('explicit transcript hash is respected', () => {
    expect(getHistoryInitialTab(transcriptOnlyEntry(), '#transcript')).toBe(
      'transcript'
    );
  });

  it('original Turkish and English transcript comes from transcript-only history', () => {
    const data = getOriginalTranscriptData(transcriptOnlyEntry());

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      text: 'Merhaba',
      secondaryText: 'Hello'
    });
  });
});
