import { describe, it, expect } from 'vitest';
import { evaluateQuality } from './quality';
import { TranscriptSegment, CaptionTrack } from './types';

describe('Transcript Quality', () => {
  it('should return low for empty transcript', () => {
    const track: CaptionTrack = { baseUrl: '', name: { simpleText: 'en' }, vssId: '', languageCode: 'en', isTranslatable: false, sourceType: 'manual' };
    const q = evaluateQuality([], track, 1000);
    expect(q.level).toBe('low');
    expect(q.internalScore).toBe(0);
  });

  it('should return high for manual with no gaps', () => {
    const track: CaptionTrack = { baseUrl: '', name: { simpleText: 'en' }, vssId: '', languageCode: 'en', isTranslatable: false, sourceType: 'manual' };
    const segments: TranscriptSegment[] = [
      { id: '1', sequence: 1, startTimeMs: 0, endTimeMs: 5000, durationMs: 5000, text: 'hello', cleanText: 'hello', languageCode: 'en' },
      { id: '2', sequence: 2, startTimeMs: 5000, endTimeMs: 10000, durationMs: 5000, text: 'world', cleanText: 'world', languageCode: 'en' }
    ];
    const q = evaluateQuality(segments, track, 10000);
    expect(q.level).toBe('high');
    expect(q.internalScore).toBe(100);
  });

  it('should return medium for automatic transcript', () => {
    const track: CaptionTrack = { baseUrl: '', name: { simpleText: 'en' }, vssId: '', languageCode: 'en', isTranslatable: false, sourceType: 'automatic' };
    const segments: TranscriptSegment[] = [
      { id: '1', sequence: 1, startTimeMs: 0, endTimeMs: 5000, durationMs: 5000, text: 'hello', cleanText: 'hello', languageCode: 'en' },
    ];
    const q = evaluateQuality(segments, track, 5000);
    expect(q.level).toBe('medium');
    expect(q.reasons.some(r => r.includes('Otomatik'))).toBe(true);
  });
});
