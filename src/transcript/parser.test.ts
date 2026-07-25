// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseXMLTranscript } from './parser';

describe('Transcript Parser', () => {
  it('should parse valid XML', () => {
    const xml = `
      <transcript>
        <text start="0" dur="5.5">hello</text>
        <text start="5.5" dur="4.5">world</text>
      </transcript>
    `;
    const segments = parseXMLTranscript(xml, 'en');
    expect(segments.length).toBe(2);
    expect(segments[0].startTimeMs).toBe(0);
    expect(segments[0].endTimeMs).toBe(5500);
    expect(segments[0].cleanText).toBe('hello');
    
    expect(segments[1].startTimeMs).toBe(5500);
    expect(segments[1].endTimeMs).toBe(10000);
    expect(segments[1].cleanText).toBe('world');
  });

  it('should handle missing attributes', () => {
    const xml = `
      <transcript>
        <text start="10">hello</text>
        <text dur="5">world</text>
      </transcript>
    `;
    const segments = parseXMLTranscript(xml, 'en');
    expect(segments.length).toBe(1);
    // start="10" -> startTimeMs: 10000, dur=0 -> endTimeMs: 10000 (filtered out by cleaner due to <= startTimeMs)
    // Actually cleaner filters out segments where end <= start.
    // Wait, let's see what happens.
    // start=10, dur=0 -> end=10. This is <= start, so cleaner drops it.
    // Let's modify the XML to not be dropped.
    
    const xml2 = `
      <transcript>
        <text start="10" dur="2">hello</text>
        <text start="15" dur="5">world</text>
      </transcript>
    `;
    const s2 = parseXMLTranscript(xml2, 'en');
    expect(s2.length).toBe(2);
    expect(s2[0].startTimeMs).toBe(10000);
  });
});
