export interface CorrectionInputSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  turkish: string;
  english: string;
}

interface DisplayedTranscriptSegment {
  id: string;
  startTimeMs: number;
  endTimeMs: number;
  cleanText: string;
  secondaryText?: string;
}

export function prepareCorrectionInput(
  segments: DisplayedTranscriptSegment[],
  sourceLanguage: string
) {
  const isTurkishSource = sourceLanguage.startsWith('tr');
  const mappedSegments: CorrectionInputSegment[] = segments.map(segment => ({
    id: segment.id,
    startTimeMs: segment.startTimeMs,
    endTimeMs: segment.endTimeMs,
    turkish: isTurkishSource
      ? segment.cleanText
      : segment.secondaryText || '',
    english: isTurkishSource
      ? segment.secondaryText || ''
      : segment.cleanText
  }));

  let emptyTurkishSegmentCount = 0;
  let emptyEnglishSegmentCount = 0;
  let turkishCharacterCount = 0;
  let englishCharacterCount = 0;

  for (const segment of mappedSegments) {
    if (segment.turkish.trim()) {
      turkishCharacterCount += segment.turkish.length;
    } else {
      emptyTurkishSegmentCount++;
    }

    if (segment.english.trim()) {
      englishCharacterCount += segment.english.length;
    } else {
      emptyEnglishSegmentCount++;
    }
  }

  return {
    isTurkishSource,
    mappedSegments,
    emptyTurkishSegmentCount,
    emptyEnglishSegmentCount,
    turkishCharacterCount,
    englishCharacterCount,
    sourceCharacterCount: isTurkishSource
      ? turkishCharacterCount
      : englishCharacterCount
  };
}
