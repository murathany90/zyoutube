import { describe, expect, it } from 'vitest';
import {
  mapWithConcurrency,
  splitCorrectionRequest
} from './correction-chunking';

function requestWithSegments(count: number, text = 'metin') {
  return {
    taskId: 'task-1',
    transcript: {
      sourceLanguage: 'tr',
      segments: Array.from({ length: count }, (_, index) => ({
        id: `seg-${index}`,
        turkish: text,
        english: ''
      }))
    }
  };
}

describe('correction chunking', () => {
  it('segment sırasını koruyarak 40 öğelik parçalara böler', () => {
    const chunks = splitCorrectionRequest(requestWithSegments(81));

    expect(chunks.map(chunk => chunk.transcript.segments.length))
      .toEqual([40, 40, 1]);
    expect(chunks.flatMap(chunk =>
      chunk.transcript.segments.map(segment => segment.id)
    )).toEqual(
      Array.from({ length: 81 }, (_, index) => `seg-${index}`)
    );
  });

  it('karakter sınırını tek segmenti bölmeden uygular', () => {
    const chunks = splitCorrectionRequest(
      requestWithSegments(3, '12345'),
      40,
      9
    );

    expect(chunks.map(chunk => chunk.transcript.segments.length))
      .toEqual([1, 1, 1]);
  });

  it('eşzamanlı çalışan iş sayısını verilen sınırda tutar', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async value => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return value * 2;
      }
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxActive).toBe(2);
  });

  it('parçalar ters sırada tamamlansa da sonuç sırasını korur', async () => {
    const results = await mapWithConcurrency(
      [30, 20, 10],
      3,
      async delay => {
        await new Promise(resolve => setTimeout(resolve, delay));
        return `chunk-${delay}`;
      }
    );

    expect(results).toEqual(['chunk-30', 'chunk-20', 'chunk-10']);
  });

  it('bir parça hatasını kısmi sonuç döndürmeden üst katmana taşır', async () => {
    const chunkError = new Error('chunk-2-failed');

    await expect(mapWithConcurrency(
      [1, 2, 3],
      2,
      async value => {
        if (value === 2) throw chunkError;
        return value;
      }
    )).rejects.toBe(chunkError);
  });
});
