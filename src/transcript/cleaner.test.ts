import { describe, it, expect } from 'vitest';
import { decodeHTMLEntities, removeHTMLTags, cleanWhitespaces, cleanTranscript, isSoundTag } from './cleaner';
import { TranscriptSegment } from './types';

describe('Transcript Cleaner', () => {
  it('should decode HTML entities', () => {
    expect(decodeHTMLEntities('hello &amp; world')).toBe('hello & world');
    expect(decodeHTMLEntities('&lt;test&gt;')).toBe('<test>');
    expect(decodeHTMLEntities('it&#39;s a &quot;quote&quot;')).toBe('it\'s a "quote"');
  });

  it('should remove HTML tags', () => {
    expect(removeHTMLTags('Hello <b>world</b>')).toBe('Hello world');
    expect(removeHTMLTags('<font color="#cccccc">text</font>')).toBe('text');
  });

  it('should clean whitespaces', () => {
    expect(cleanWhitespaces('  hello   world  ')).toBe('hello world');
  });

  it('should identify sound tags', () => {
    expect(isSoundTag('[Music]')).toBe(true);
    expect(isSoundTag('[Applause]')).toBe(true);
    expect(isSoundTag('Music is playing')).toBe(false);
  });

  it('should filter invalid and duplicate segments', () => {
    const raw: TranscriptSegment[] = [
      { id: '1', sequence: 1, startTimeMs: -100, endTimeMs: 1000, durationMs: 1100, text: 'invalid start', cleanText: '', languageCode: 'en' },
      { id: '2', sequence: 2, startTimeMs: 2000, endTimeMs: 1000, durationMs: -1000, text: 'invalid end', cleanText: '', languageCode: 'en' },
      { id: '3', sequence: 3, startTimeMs: 1000, endTimeMs: 2000, durationMs: 1000, text: '  hello  ', cleanText: '', languageCode: 'en' },
      { id: '4', sequence: 4, startTimeMs: 2000, endTimeMs: 3000, durationMs: 1000, text: 'hello', cleanText: '', languageCode: 'en' },
      { id: '5', sequence: 5, startTimeMs: 3000, endTimeMs: 4000, durationMs: 1000, text: 'world', cleanText: '', languageCode: 'en' }
    ];

    const cleaned = cleanTranscript(raw);
    
    expect(cleaned.length).toBe(2);
    expect(cleaned[0].cleanText).toBe('hello');
    expect(cleaned[1].cleanText).toBe('world');
  });

  it('should handle sliding subtitles', () => {
    const raw: TranscriptSegment[] = [
      { id: '1', sequence: 1, startTimeMs: 1000, endTimeMs: 2000, durationMs: 1000, text: 'we need to', cleanText: '', languageCode: 'en' },
      { id: '2', sequence: 2, startTimeMs: 2000, endTimeMs: 3000, durationMs: 1000, text: 'we need to understand', cleanText: '', languageCode: 'en' },
      { id: '3', sequence: 3, startTimeMs: 3000, endTimeMs: 4000, durationMs: 1000, text: 'we need to understand the system', cleanText: '', languageCode: 'en' },
    ];
    const cleaned = cleanTranscript(raw);
    expect(cleaned.length).toBe(3);
    expect(cleaned[0].cleanText).toBe('we need to');
    expect(cleaned[1].cleanText).toBe('understand');
    expect(cleaned[2].cleanText).toBe('the system');
  });

  it('should handle overlapping subtitles', () => {
    const raw: TranscriptSegment[] = [
      { id: '1', sequence: 1, startTimeMs: 1000, endTimeMs: 2000, durationMs: 1000, text: 'the system is stable', cleanText: '', languageCode: 'en' },
      { id: '2', sequence: 2, startTimeMs: 2000, endTimeMs: 3000, durationMs: 1000, text: 'system is stable under normal', cleanText: '', languageCode: 'en' },
      { id: '3', sequence: 3, startTimeMs: 3000, endTimeMs: 4000, durationMs: 1000, text: 'is stable under normal conditions', cleanText: '', languageCode: 'en' },
    ];
    const cleaned = cleanTranscript(raw);
    expect(cleaned.length).toBe(3);
    expect(cleaned[0].cleanText).toBe('the system is stable');
    expect(cleaned[1].cleanText).toBe('under normal');
    expect(cleaned[2].cleanText).toBe('conditions');
  });
});
