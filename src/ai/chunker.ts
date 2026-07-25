import { TranscriptSegment } from '../transcript/types';

export interface TranscriptChunk {
  index: number;
  segments: TranscriptSegment[];
  startTimeMs: number;
  endTimeMs: number;
  charCount: number;
  estimatedTokens: number;
}

export class TranscriptChunker {
  static readonly CHARS_PER_TOKEN = 4;
  
  static chunkSegments(segments: TranscriptSegment[], maxTokensPerChunk: number): TranscriptChunk[] {
    if (!segments || segments.length === 0) return [];

    const chunks: TranscriptChunk[] = [];
    let currentChunkSegments: TranscriptSegment[] = [];
    let currentChunkCharCount = 0;
    const maxChars = maxTokensPerChunk * this.CHARS_PER_TOKEN;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const segmentChars = segment.cleanText.length;
      
      // If a single segment is too large, we still add it (avoiding empty chunks or infinite loops)
      // but it will form a chunk on its own (or be the last item in a chunk that exceeds the limit slightly).
      if (currentChunkSegments.length > 0 && currentChunkCharCount + segmentChars > maxChars) {
        chunks.push(this.createChunkObj(chunks.length, currentChunkSegments, currentChunkCharCount));
        currentChunkSegments = [];
        currentChunkCharCount = 0;
      }
      
      currentChunkSegments.push(segment);
      currentChunkCharCount += segmentChars;
    }

    if (currentChunkSegments.length > 0) {
      chunks.push(this.createChunkObj(chunks.length, currentChunkSegments, currentChunkCharCount));
    }

    return chunks;
  }

  private static createChunkObj(index: number, segments: TranscriptSegment[], charCount: number): TranscriptChunk {
    return {
      index,
      segments,
      startTimeMs: segments[0].startTimeMs,
      endTimeMs: segments[segments.length - 1].endTimeMs || segments[segments.length - 1].startTimeMs,
      charCount,
      estimatedTokens: Math.ceil(charCount / this.CHARS_PER_TOKEN)
    };
  }
}
