export type CorrectionTimeoutKind =
  | 'first-byte'
  | 'stream-idle'
  | 'total';

export interface CorrectionReadMetrics {
  contentType: string;
  firstByteMs: number | null;
  chunkCount: number;
  receivedBytes: number;
  receivedCharacters: number;
  lastSseEventAtMs: number | null;
  sseEventCount: number;
  contentChunkCount: number;
  contentCharacters: number;
  reasoningCharacters: number;
}

export interface CorrectionResponseResult {
  content: string;
  reasoningContent: string;
  finishReason: string;
  streamDoneReceived: boolean;
  transport: 'sse' | 'json' | 'text';
  metrics: CorrectionReadMetrics;
}

export interface CorrectionResponseReaderOptions {
  expectedStreaming: boolean;
  firstByteTimeoutMs: number;
  streamIdleTimeoutMs: number;
  requestStartedAtMs?: number;
  now?: () => number;
  onProgress?: (metrics: CorrectionReadMetrics) => void;
}

export class CorrectionResponseTimeoutError extends Error {
  readonly code = 'CORRECTION_TIMEOUT';
  readonly timeoutKind: CorrectionTimeoutKind;
  readonly diagnostics: Record<string, unknown>;

  constructor(
    timeoutKind: CorrectionTimeoutKind,
    diagnostics: Record<string, unknown>
  ) {
    super(
      timeoutKind === 'first-byte'
        ? 'API yanıtının ilk byte verisi zamanında gelmedi.'
        : 'API yanıt akışı veri gelmeden zaman aşımına uğradı.'
    );
    this.name = 'CorrectionResponseTimeoutError';
    this.timeoutKind = timeoutKind;
    this.diagnostics = { timeoutKind, ...diagnostics };
  }
}

function normalizeContentPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';

  return value.map((part: any) => {
    if (typeof part === 'string') return part;
    return part?.text || part?.content || '';
  }).join('');
}

function parseOpenAiEnvelope(
  value: any,
  rawText: string
): {
  content: string;
  reasoningContent: string;
  finishReason: string;
} {
  const choice = value?.choices?.[0];
  if (!choice) {
    return {
      content: rawText,
      reasoningContent: '',
      finishReason: ''
    };
  }

  return {
    content: normalizeContentPart(
      choice.message?.content ?? choice.delta?.content
    ),
    reasoningContent: normalizeContentPart(
      choice.message?.reasoning_content ??
      choice.delta?.reasoning_content
    ),
    finishReason: choice.finish_reason || ''
  };
}

function timeoutDiagnostics(
  metrics: CorrectionReadMetrics
): Record<string, unknown> {
  return {
    chunkCount: metrics.chunkCount,
    receivedBytes: metrics.receivedBytes,
    receivedCharacters: metrics.receivedCharacters,
    lastSseEventAtMs: metrics.lastSseEventAtMs,
    sseEventCount: metrics.sseEventCount,
    contentChunkCount: metrics.contentChunkCount,
    contentCharacters: metrics.contentCharacters,
    reasoningCharacters: metrics.reasoningCharacters
  };
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
  timeoutKind: Exclude<CorrectionTimeoutKind, 'total'>,
  metrics: CorrectionReadMetrics
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new CorrectionResponseTimeoutError(
            timeoutKind,
            timeoutDiagnostics(metrics)
          ));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function readCorrectionResponse(
  response: Response,
  options: CorrectionResponseReaderOptions
): Promise<CorrectionResponseResult> {
  const now = options.now ?? (() => performance.now());
  const startedAt = options.requestStartedAtMs ?? now();
  const responseContentType =
    response.headers?.get?.('content-type') || 'unknown';
  const metrics: CorrectionReadMetrics = {
    contentType: responseContentType,
    firstByteMs: null,
    chunkCount: 0,
    receivedBytes: 0,
    receivedCharacters: 0,
    lastSseEventAtMs: null,
    sseEventCount: 0,
    contentChunkCount: 0,
    contentCharacters: 0,
    reasoningCharacters: 0
  };

  if (!response.body) {
    const responseWithLegacyMethods = response as Response & {
      json?: () => Promise<any>;
      text?: () => Promise<string>;
    };

    if (typeof responseWithLegacyMethods.json === 'function') {
      const parsed = await responseWithLegacyMethods.json();
      const rawText = JSON.stringify(parsed);
      const envelope = parseOpenAiEnvelope(parsed, rawText);
      metrics.contentCharacters = envelope.content.length;
      metrics.reasoningCharacters = envelope.reasoningContent.length;
      return {
        ...envelope,
        streamDoneReceived: false,
        transport: 'json',
        metrics
      };
    }

    if (typeof responseWithLegacyMethods.text === 'function') {
      const rawText = await responseWithLegacyMethods.text();
      metrics.contentCharacters = rawText.length;
      return {
        content: rawText,
        reasoningContent: '',
        finishReason: '',
        streamDoneReceived: false,
        transport: 'text',
        metrics
      };
    }

    return {
      content: '',
      reasoningContent: '',
      finishReason: '',
      streamDoneReceived: false,
      transport: 'text',
      metrics
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let content = '';
  let reasoningContent = '';
  let finishReason = '';
  let streamDoneReceived = false;
  let buffer = '';
  let rawText = '';
  let firstByteSeen = false;
  let contentEventMode: 'none' | 'delta' | 'message' = 'none';
  let reasoningEventMode: 'none' | 'delta' | 'message' = 'none';
  let sseDetected = responseContentType
    .toLowerCase()
    .includes('text/event-stream');

  const processSseLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;

    const dataText = trimmed.slice(5).trim();
    if (dataText === '[DONE]') {
      streamDoneReceived = true;
      return true;
    }

    try {
      const data = JSON.parse(dataText);
      metrics.sseEventCount += 1;
      metrics.lastSseEventAtMs = Math.round(now() - startedAt);

      const choice = data?.choices?.[0];
      const deltaContent = normalizeContentPart(choice?.delta?.content);
      const messageContent = normalizeContentPart(choice?.message?.content);
      const deltaReasoning = normalizeContentPart(
        choice?.delta?.reasoning_content
      );
      const messageReasoning = normalizeContentPart(
        choice?.message?.reasoning_content
      );

      if (deltaContent) {
        content += deltaContent;
        contentEventMode = 'delta';
        metrics.contentChunkCount += 1;
      } else if (messageContent) {
        content = contentEventMode === 'delta'
          ? content + messageContent
          : messageContent;
        if (contentEventMode === 'none') contentEventMode = 'message';
        metrics.contentChunkCount += 1;
      }
      if (deltaReasoning) {
        reasoningContent += deltaReasoning;
        reasoningEventMode = 'delta';
      } else if (messageReasoning) {
        reasoningContent = reasoningEventMode === 'delta'
          ? reasoningContent + messageReasoning
          : messageReasoning;
        if (reasoningEventMode === 'none') reasoningEventMode = 'message';
      }
      metrics.contentCharacters = content.length;
      metrics.reasoningCharacters = reasoningContent.length;
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
        return true;
      }
    } catch {
      // A malformed complete SSE event is ignored.
    }

    return false;
  };

  try {
    while (true) {
      const readResult = await readWithTimeout(
        reader,
        firstByteSeen
          ? options.streamIdleTimeoutMs
          : options.firstByteTimeoutMs,
        firstByteSeen ? 'stream-idle' : 'first-byte',
        metrics
      );

      if (readResult.done) {
        buffer += decoder.decode();
        if (sseDetected && buffer.trim()) processSseLine(buffer);
        break;
      }

      const value = readResult.value;
      if (!value || value.byteLength === 0) continue;

      const decoded = decoder.decode(value, { stream: true });
      if (!firstByteSeen) {
        firstByteSeen = true;
        metrics.firstByteMs = Math.round(now() - startedAt);
      }

      metrics.chunkCount += 1;
      metrics.receivedBytes += value.byteLength;
      metrics.receivedCharacters += decoded.length;
      rawText += decoded;

      if (
        !sseDetected &&
        !responseContentType.toLowerCase().includes('json') &&
        rawText.trimStart().startsWith('data:')
      ) {
        sseDetected = true;
        buffer = rawText;
      } else if (sseDetected) {
        buffer += decoded;
      }

      if (sseDetected) {
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        let completed = false;
        for (const line of lines) {
          if (processSseLine(line)) completed = true;
        }
        options.onProgress?.({ ...metrics });

        if (completed) {
          void (reader as any).cancel?.().catch(() => undefined);
          break;
        }
      }
    }
  } catch (error) {
    void (reader as any).cancel?.().catch(() => undefined);
    throw error;
  }

  if (sseDetected) {
    return {
      content,
      reasoningContent,
      finishReason,
      streamDoneReceived,
      transport: 'sse',
      metrics
    };
  }

  const trimmedRaw = rawText.trim();
  const looksLikeJson =
    responseContentType.toLowerCase().includes('json') ||
    (
      responseContentType === 'unknown' &&
      (trimmedRaw.startsWith('{') || trimmedRaw.startsWith('['))
    );

  if (looksLikeJson) {
    try {
      const parsed = JSON.parse(trimmedRaw);
      const envelope = parseOpenAiEnvelope(parsed, rawText);
      metrics.contentCharacters = envelope.content.length;
      metrics.reasoningCharacters = envelope.reasoningContent.length;
      return {
        ...envelope,
        streamDoneReceived: false,
        transport: 'json',
        metrics
      };
    } catch {
      // Let the correction parser produce the final JSON diagnostic.
    }
  }

  return {
    content: rawText,
    reasoningContent: '',
    finishReason: '',
    streamDoneReceived: false,
    transport: 'text',
    metrics: {
      ...metrics,
      contentCharacters: rawText.length
    }
  };
}
