import { TranscriptSegment } from './types';
import { cleanTranscript } from './cleaner';

export const parseXMLTranscript = (xmlText: string, languageCode: string): TranscriptSegment[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
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
};
