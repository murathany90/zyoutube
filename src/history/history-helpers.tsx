import React from 'react';

/**
 * Normalizes text for Turkish case-insensitive search
 */
export function normalizeTurkishSearch(text: string): string {
  if (!text) return '';
  return text.normalize('NFKC').toLocaleLowerCase('tr-TR');
}

/**
 * Highlights a search query in a text string without using dangerouslySetInnerHTML.
 */
export function highlightSearchText(text: string, query: string): React.ReactNode {
  if (!query || !text) return <>{text}</>;
  
  const normalizedQuery = normalizeTurkishSearch(query);
  const normalizedText = normalizeTurkishSearch(text);
  
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  if (matchIndex === -1) return <>{text}</>;

  const originalBefore = text.slice(0, matchIndex);
  const originalMatch = text.slice(matchIndex, matchIndex + query.length);
  const originalAfter = text.slice(matchIndex + query.length);

  return (
    <>
      {originalBefore}
      <mark className="zy-search-highlight">{originalMatch}</mark>
      {highlightSearchText(originalAfter, query)}
    </>
  );
}

export interface SearchMatch {
  index: number;
  type: 'summary' | 'transcript' | 'corrected';
  sentenceId?: string;
  field: string;
}

/**
 * Common search logic to find occurrences in transcript/corrected transcript
 */
export function searchInTranscripts(
  sentences: any[],
  query: string,
  fields: string[]
): SearchMatch[] {
  if (!query) return [];
  const normalizedQuery = normalizeTurkishSearch(query);
  const matches: SearchMatch[] = [];

  sentences.forEach((sentence, idx) => {
    let hasMatch = false;
    for (const field of fields) {
      const val = sentence[field];
      if (val && typeof val === 'string' && normalizeTurkishSearch(val).includes(normalizedQuery)) {
        hasMatch = true;
        break;
      }
    }
    if (hasMatch) {
      matches.push({ index: idx, type: 'transcript', sentenceId: sentence.id || sentence.startTimeMs?.toString(), field: 'all' });
    }
  });

  return matches;
}
