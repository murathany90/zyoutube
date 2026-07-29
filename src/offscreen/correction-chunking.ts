interface CorrectionSegment {
  id: string;
  turkish?: string;
  english?: string;
}

interface CorrectionRequestLike {
  transcript: {
    segments: CorrectionSegment[];
  };
  [key: string]: any;
}

export function splitCorrectionRequest<T extends CorrectionRequestLike>(
  request: T,
  maxSegments = 40,
  maxCharacters = 6_000
): T[] {
  const sourceSegments = request.transcript.segments;
  if (sourceSegments.length === 0) return [request];

  const chunks: CorrectionSegment[][] = [];
  let current: CorrectionSegment[] = [];
  let currentCharacters = 0;

  for (const segment of sourceSegments) {
    const segmentCharacters =
      String(segment.turkish || '').length +
      String(segment.english || '').length;
    const exceedsLimit =
      current.length > 0 &&
      (
        current.length >= maxSegments ||
        currentCharacters + segmentCharacters > maxCharacters
      );

    if (exceedsLimit) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }

    current.push(segment);
    currentCharacters += segmentCharacters;
  }

  if (current.length > 0) chunks.push(current);
  if (chunks.length === 1) return [request];

  return chunks.map(segments => ({
    ...request,
    transcript: {
      ...request.transcript,
      segments
    }
  }));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
  );

  await Promise.all(runners);
  return results;
}
