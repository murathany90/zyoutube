import { describe, it, expect } from 'vitest';
import { TranscriptChunker } from './chunker';
import { TranscriptSegment } from '../transcript/types';

describe('TranscriptChunker', () => {
  it('should not split if under max tokens', () => {
    const segments: TranscriptSegment[] = [
      { text: 'A short sentence.', cleanText: 'A short sentence.', startTimeMs: 0, endTimeMs: 1000 } as TranscriptSegment,
      { text: 'Another short sentence.', cleanText: 'Another short sentence.', startTimeMs: 1000, endTimeMs: 2000 } as TranscriptSegment
    ];
    const chunks = TranscriptChunker.chunkSegments(segments, 1000); // very high limit
    expect(chunks.length).toBe(1);
    expect(chunks[0].segments.length).toBe(2);
    expect(chunks[0].startTimeMs).toBe(0);
    expect(chunks[0].endTimeMs).toBe(2000);
  });

  it('should split if exceeding max tokens', () => {
    const segments: TranscriptSegment[] = [
      { text: 'First part.', cleanText: 'First part.', startTimeMs: 0, endTimeMs: 1000 } as TranscriptSegment,
      { text: 'Second part.', cleanText: 'Second part.', startTimeMs: 1000, endTimeMs: 2000 } as TranscriptSegment,
      { text: 'Third part.', cleanText: 'Third part.', startTimeMs: 2000, endTimeMs: 3000 } as TranscriptSegment
    ];
    // "First part." (11 chars), "Second part." (12 chars), "Third part." (11 chars)
    // 4 chars per token. Let's say maxTokens = 4 -> maxChars = 16.
    const chunks = TranscriptChunker.chunkSegments(segments, 4); 
    
    // Chunk 1: "First part." -> 11 chars (can fit, next one makes it 23 > 16, so splits)
    // Chunk 2: "Second part." -> 12 chars (can fit, next makes it 23 > 16, so splits)
    // Chunk 3: "Third part."
    
    expect(chunks.length).toBe(3);
    expect(chunks[0].segments[0].text).toBe('First part.');
    expect(chunks[1].segments[0].text).toBe('Second part.');
    expect(chunks[2].segments[0].text).toBe('Third part.');
  });
});
