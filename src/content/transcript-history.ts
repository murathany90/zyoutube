import { HistoryService, type TranscriptHistoryMetadata } from '../settings/history';
import type { TranscriptResult } from '../transcript/types';

interface PersistDisplayedTranscriptInput {
  videoId: string;
  title: string;
  url: string;
  result: TranscriptResult;
  displayedLanguage: 'tr' | 'en' | 'both';
}

interface PersistDisplayedTranscriptDependencies {
  saveTranscript: typeof HistoryService.saveTranscript;
  notifyLibrary: (message: {
    type: 'LIBRARY_ENTRY_UPDATED';
    videoId: string;
    reason: 'transcript';
  }) => Promise<unknown>;
}

const defaultDependencies: PersistDisplayedTranscriptDependencies = {
  saveTranscript: (...args) => HistoryService.saveTranscript(...args),
  notifyLibrary: message => chrome.runtime.sendMessage(message)
};

export async function persistDisplayedTranscript(
  input: PersistDisplayedTranscriptInput,
  dependencies: PersistDisplayedTranscriptDependencies = defaultDependencies
): Promise<boolean> {
  if (input.result.segments.length === 0) return false;

  const selectedTrack = input.result.selectedTrack;
  const metadata: TranscriptHistoryMetadata = {
    languageCode:
      input.result.segments[0]?.languageCode ||
      selectedTrack?.languageCode ||
      'unknown',
    trackLanguage: selectedTrack?.languageCode,
    sourceType: selectedTrack?.sourceType,
    displayedLanguage: input.displayedLanguage
  };

  await dependencies.saveTranscript(
    {
      videoId: input.videoId,
      title: input.title,
      url: input.url
    },
    input.result.segments,
    metadata
  );

  await dependencies.notifyLibrary({
    type: 'LIBRARY_ENTRY_UPDATED',
    videoId: input.videoId,
    reason: 'transcript'
  });
  return true;
}
