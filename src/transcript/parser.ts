import { TranscriptSegment } from './types';
import { cleanTranscript } from './cleaner';

export const parseTranscript = (text: string, languageCode: string): TranscriptSegment[] => {
  if (text.trim().startsWith('{')) {
    return parseJSON3Transcript(text, languageCode);
  }
  return parseXMLTranscript(text, languageCode);
};

export const parseJSON3Transcript = (jsonText: string, languageCode: string): TranscriptSegment[] => {
  try {
    const data = JSON.parse(jsonText);
    const events = data.events || [];
    const rawSegments: TranscriptSegment[] = [];
    
    let i = 0;
    for (const event of events) {
      if (!event.segs) continue;
      
      const startTimeMs = event.tStartMs || 0;
      const durationMs = event.dDurationMs || 0;
      const endTimeMs = startTimeMs + durationMs;
      
      let content = '';
      for (const seg of event.segs) {
        if (seg.utf8) content += seg.utf8;
      }
      
      if (content.trim()) {
        rawSegments.push({
          id: `seg-${i}`,
          sequence: i++,
          startTimeMs,
          endTimeMs,
          durationMs,
          text: content,
          cleanText: '',
          languageCode,
        });
      }
    }
    
    return cleanTranscript(rawSegments);
  } catch (e) {
    throw new Error('JSON3 parsing failed');
  }
};

export const parseXMLTranscript = (xmlText: string, languageCode: string): TranscriptSegment[] => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    
    // Check for parsing errors
    const errorNode = xmlDoc.querySelector('parsererror');
    if (errorNode) throw new Error('XML parsing failed');

    const textNodes = xmlDoc.getElementsByTagName('text');

    const rawSegments: TranscriptSegment[] = [];

    for (let i = 0; i < textNodes.length; i++) {
      const t = textNodes[i];
      const startStr = t.getAttribute('start') || '0';
      const durStr = t.getAttribute('dur') || '0';
      const content = t.textContent || '';

      const start = parseFloat(startStr);
      const dur = parseFloat(durStr);
      const startTimeMs = Math.round(start * 1000);
      const durationMs = Math.round(dur * 1000);
      const endTimeMs = startTimeMs + durationMs;

      rawSegments.push({
        id: `seg-${i}`,
        sequence: i,
        startTimeMs,
        endTimeMs,
        durationMs,
        text: content,
        cleanText: '', // Will be filled by cleaner
        languageCode,
      });
    }

    return cleanTranscript(rawSegments);
  } catch (e) {
    throw new Error('XML parsing failed');
  }
};
