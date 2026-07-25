import { TranscriptSegment } from './types';

// Decodes HTML entities
export const decodeHTMLEntities = (text: string): string => {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

// Removes HTML tags (like <b>, <i>, <font>)
export const removeHTMLTags = (text: string): string => {
  return text.replace(/<[^>]*>?/gm, '');
};

// Cleans extra whitespaces
export const cleanWhitespaces = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

// Classifies if the text is just a sound tag
export const isSoundTag = (text: string): boolean => {
  const match = text.match(/^\[.*?\]$/);
  return match !== null;
};

// Advanced merging for overlapping sliding subtitles
const mergeSlidingText = (prev: string, current: string): string => {
  if (!prev) return current;
  if (prev === current) return ""; // exact duplicate

  // Check if current text is just an expansion of prev (sliding)
  // e.g. prev: "hello", current: "hello world" -> return "world"
  // e.g. prev: "we need to", current: "we need to understand" -> return "understand"
  if (current.startsWith(prev)) {
    return current.substring(prev.length).trim();
  }
  
  // Check partial overlap at the end of prev and beginning of current
  // prev: "the system is stable", current: "system is stable under normal"
  const prevWords = prev.split(' ');
  const currWords = current.split(' ');
  
  for (let i = 0; i < prevWords.length; i++) {
    const suffix = prevWords.slice(i).join(' ');
    const prefix = currWords.slice(0, prevWords.length - i).join(' ');
    
    if (suffix === prefix) {
      // Overlap found
      const newPart = currWords.slice(prevWords.length - i).join(' ');
      return newPart;
    }
  }

  // Not sliding or overlapping, return full current string
  return current;
};

export const cleanTranscript = (segments: TranscriptSegment[]): TranscriptSegment[] => {
  const cleaned: TranscriptSegment[] = [];
  let lastCleanText = '';
  let lastStartTime = -1;

  for (const seg of segments) {
    // 1. Skip invalid negative times
    if (seg.startTimeMs < 0 || seg.endTimeMs < 0 || isNaN(seg.startTimeMs) || isNaN(seg.endTimeMs)) continue;
    
    // 2. Ensure end is after start
    if (seg.endTimeMs <= seg.startTimeMs) continue;

    let text = decodeHTMLEntities(seg.text);
    text = removeHTMLTags(text);
    text = cleanWhitespaces(text);

    // 3. Skip empty segments
    if (!text) continue;

    // 4. Advanced Sliding Text Merge
    // Only apply sliding merge if the times are very close (e.g. within 2 seconds)
    // If it's a completely new sentence later in the video, don't merge even if it matches
    const isClose = lastStartTime === -1 || (seg.startTimeMs - lastStartTime) < 2000;
    
    let finalCleanText = text;
    if (isClose) {
      finalCleanText = mergeSlidingText(lastCleanText, text);
    }
    
    if (!finalCleanText) continue;

    cleaned.push({
      ...seg,
      cleanText: finalCleanText
    });
    
    // We update lastCleanText with the FULL original text of this segment 
    // so the NEXT segment can overlap against the full current segment
    lastCleanText = text; 
    lastStartTime = seg.startTimeMs;
  }

  // Ensure they are sorted by startTimeMs
  cleaned.sort((a, b) => a.startTimeMs - b.startTimeMs);

  return cleaned;
};
