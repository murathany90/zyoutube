import { VideoLibraryEntry } from '../history/library-service';

export function getLibraryCardState(entry: VideoLibraryEntry) {
  return {
    showSummaryBadge: entry.hasSummary,
    showTranscriptBadge: entry.hasOriginalTranscript,
    showCorrectionBadge: entry.hasCorrectedTranscript,
    showNoSummary: !entry.hasSummary && entry.hasOriginalTranscript
  };
}

export function filterLibraryEntries(
  entries: VideoLibraryEntry[],
  searchQuery: string,
  typeFilter: string,
  sortOrder: string
): VideoLibraryEntry[] {
  let filtered = entries;

  // Search
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(e => {
      if (e.title.toLowerCase().includes(q)) return true;
      if (e.savedSummary?.summary?.summary?.tr?.toLowerCase().includes(q)) return true;
      if (e.savedSummary?.summary?.summary?.en?.toLowerCase().includes(q)) return true;
      if (e.savedSummary?.summary?.keyIdeas?.some(k => 
        k.description?.tr?.toLowerCase().includes(q) || 
        k.description?.en?.toLowerCase().includes(q) ||
        k.title?.tr?.toLowerCase().includes(q) ||
        k.title?.en?.toLowerCase().includes(q)
      )) return true;
      if (e.correctedTranscript?.sentences?.some(s => 
        s.correctedTurkish?.toLowerCase().includes(q) || 
        s.correctedEnglish?.toLowerCase().includes(q)
      )) return true;
      if (e.studyWords?.some(w => 
        w.displayWord.toLowerCase().includes(q) || 
        w.meaningsTr.some(m => m.toLowerCase().includes(q)) || 
        w.englishSentence.toLowerCase().includes(q) || 
        w.turkishSentence.toLowerCase().includes(q)
      )) return true;
      return false;
    });
  }

  // Filter
  if (typeFilter === 'summary') filtered = filtered.filter(e => e.hasSummary);
  else if (typeFilter === 'correction') filtered = filtered.filter(e => e.hasCorrectedTranscript);
  else if (typeFilter === 'words') filtered = filtered.filter(e => e.hasStudyWords);
  else if (typeFilter === 'transcript') filtered = filtered.filter(e => e.hasOriginalTranscript && !e.hasSummary && !e.hasCorrectedTranscript);

  // Sort
  filtered = [...filtered].sort((a, b) => {
    const dateA = a.updatedAt;
    const dateB = b.updatedAt;
    if (sortOrder === 'latest') return dateB - dateA;
    if (sortOrder === 'oldest') return dateA - dateB;
    if (sortOrder === 'az') return a.title.localeCompare(b.title);
    if (sortOrder === 'za') return b.title.localeCompare(a.title);
    return 0;
  });

  return filtered;
}
