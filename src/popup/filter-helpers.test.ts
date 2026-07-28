import { describe, it, expect } from 'vitest';
import { filterLibraryEntries, getLibraryCardState } from './filter-helpers';
import { VideoLibraryEntry } from '../history/library-service';

describe('filterLibraryEntries', () => {
  const dummyEntries = [
    {
      videoId: 'v1',
      title: 'Test Summary Video',
      url: '',
      createdAt: 100,
      updatedAt: 100,
      studyWordCount: 0,
      hasSummary: true,
      hasOriginalTranscript: true,
      hasCorrectedTranscript: false,
      hasStudyWords: false,
      savedSummary: {
        videoId: 'v1',
        title: 'Test Summary Video',
        url: '',
        date: 100,
        summary: {
          summary: { tr: 'Harika bir test', en: 'Great test' },
          keyIdeas: []
        },
        transcript: []
      }
    },
    {
      videoId: 'v2',
      title: 'Correction Video',
      url: '',
      createdAt: 200,
      updatedAt: 200,
      studyWordCount: 0,
      hasSummary: false,
      hasOriginalTranscript: true,
      hasCorrectedTranscript: true,
      hasStudyWords: false,
      correctedTranscript: {
        videoId: 'v2',
        sourceLanguage: 'en',
        sentences: [
          {
            id: 's1',
            startTimeMs: 0,
            endTimeMs: 1000,
            sourceSegmentIds: [],
            originalEnglish: 'Hello',
            originalTurkish: '',
            correctedEnglish: 'Hello world',
            correctedTurkish: 'Merhaba dünya',
            sourceLanguage: 'en'
          }
        ],
        createdAt: 200
      }
    },
    {
      videoId: 'v3',
      title: 'Words Video',
      url: '',
      createdAt: 300,
      updatedAt: 300,
      studyWordCount: 1,
      hasSummary: false,
      hasOriginalTranscript: false,
      hasCorrectedTranscript: false,
      hasStudyWords: true,
      studyWords: [
        {
          id: 'w1',
          normalizedWord: 'apple',
          displayWord: 'Apple',
          meaningsTr: ['Elma'],
          definitionsEn: [],
          synonyms: [],
          antonyms: [],
          englishSentence: 'I eat an apple.',
          turkishSentence: 'Bir elma yerim.',
          videoId: 'v3',
          createdAt: 300,
          updatedAt: 300
        }
      ]
    }
  ] as any as VideoLibraryEntry[];

  it('should filter by query across summary, correction, and words', () => {
    // Search summary
    expect(filterLibraryEntries(dummyEntries, 'harika', 'all', 'latest').map(e => e.videoId)).toEqual(['v1']);
    // Search correction turkish
    expect(filterLibraryEntries(dummyEntries, 'dünya', 'all', 'latest').map(e => e.videoId)).toEqual(['v2']);
    // Search word meanings
    expect(filterLibraryEntries(dummyEntries, 'elma', 'all', 'latest').map(e => e.videoId)).toEqual(['v3']);
  });

  it('should filter by type', () => {
    expect(filterLibraryEntries(dummyEntries, '', 'summary', 'latest').map(e => e.videoId)).toEqual(['v1']);
    expect(filterLibraryEntries(dummyEntries, '', 'correction', 'latest').map(e => e.videoId)).toEqual(['v2']);
    expect(filterLibraryEntries(dummyEntries, '', 'words', 'latest').map(e => e.videoId)).toEqual(['v3']);
  });

  it('should sort by date', () => {
    expect(filterLibraryEntries(dummyEntries, '', 'all', 'latest').map(e => e.videoId)).toEqual(['v3', 'v2', 'v1']);
    expect(filterLibraryEntries(dummyEntries, '', 'all', 'oldest').map(e => e.videoId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('transcript-only card shows transcript and no-summary states together', () => {
    const transcriptOnly = {
      ...dummyEntries[0],
      hasSummary: false,
      hasOriginalTranscript: true,
      hasCorrectedTranscript: false,
      savedSummary: {
        ...dummyEntries[0].savedSummary,
        summary: undefined,
        transcript: [{ text: 'Transcript' }]
      }
    } as VideoLibraryEntry;

    expect(getLibraryCardState(transcriptOnly)).toEqual({
      showSummaryBadge: false,
      showTranscriptBadge: true,
      showCorrectionBadge: false,
      showNoSummary: true
    });
  });
});
