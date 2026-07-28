import { describe, expect, it, vi } from 'vitest';
import {
  CorrectionResponseTimeoutError,
  readCorrectionResponse
} from './correction-response-reader';

const encoder = new TextEncoder();

function responseFromStream(
  stream: ReadableStream<Uint8Array>,
  contentType = 'text/event-stream'
): Response {
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': contentType }
  });
}

describe('readCorrectionResponse', () => {
  it('finish_reason geldikten sonra açık kalan 200 stream body beklenmez', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data:{"choices":[{"delta":{"content":"{\\"sentences\\":[]}"},"finish_reason":"stop"}]}\n\n'
        ));
      }
    });

    const result = await readCorrectionResponse(
      responseFromStream(stream),
      {
        expectedStreaming: true,
        firstByteTimeoutMs: 50,
        streamIdleTimeoutMs: 50
      }
    );

    expect(result.content).toBe('{"sentences":[]}');
    expect(result.finishReason).toBe('stop');
    expect(result.metrics.chunkCount).toBe(1);
  });

  it('ilk byte gelmezse first-byte timeout üretir', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    const pending = readCorrectionResponse(
      responseFromStream(stream),
      {
        expectedStreaming: true,
        firstByteTimeoutMs: 100,
        streamIdleTimeoutMs: 500
      }
    );

    const assertion = expect(pending).rejects.toMatchObject({
      code: 'CORRECTION_TIMEOUT',
      timeoutKind: 'first-byte'
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    vi.useRealTimers();
  });

  it('birkaç chunk sonrası donarsa stream-idle timeout üretir', async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      }
    });
    const pending = readCorrectionResponse(
      responseFromStream(stream),
      {
        expectedStreaming: true,
        firstByteTimeoutMs: 100,
        streamIdleTimeoutMs: 100
      }
    );

    streamController.enqueue(encoder.encode(
      'data: {"choices":[{"delta":{"content":"parça"}}]}\n\n'
    ));
    await vi.advanceTimersByTimeAsync(1);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'CORRECTION_TIMEOUT',
      timeoutKind: 'stream-idle'
    });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    vi.useRealTimers();
  });

  it('parçalanmış SSE, data: boşluksuz satır ve son newline olmayan buffer ayrıştırılır', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data:{\"choices\":[{\"delta\":{\"content\":\"mer'));
        controller.enqueue(encoder.encode('haba\"}}]}\n\ndata: {\"choices\":[{\"message\":{\"content\":\" dünya\"},\"finish_reason\":\"stop\"}]}'));
        controller.close();
      }
    });

    const result = await readCorrectionResponse(
      responseFromStream(stream),
      {
        expectedStreaming: true,
        firstByteTimeoutMs: 50,
        streamIdleTimeoutMs: 50
      }
    );

    expect(result.content).toBe('merhaba dünya');
    expect(result.finishReason).toBe('stop');
    expect(result.metrics.sseEventCount).toBe(2);
  });

  it('[DONE] akışı sonlandırır ve reasoning final içeriğe karışmaz', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"choices":[{"delta":{"reasoning_content":"düşünce"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"nihai"}}]}\n\n' +
          'data: [DONE]\n\n'
        ));
      }
    });

    const result = await readCorrectionResponse(
      responseFromStream(stream),
      {
        expectedStreaming: true,
        firstByteTimeoutMs: 50,
        streamIdleTimeoutMs: 50
      }
    );

    expect(result.content).toBe('nihai');
    expect(result.reasoningContent).toBe('düşünce');
    expect(result.streamDoneReceived).toBe(true);
  });

  it('stream beklenirken gelen normal JSON response fallback ile ayrıştırılır', async () => {
    const response = new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"sentences":[]}',
          reasoning_content: 'ayrı'
        },
        finish_reason: 'stop'
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

    const result = await readCorrectionResponse(response, {
      expectedStreaming: true,
      firstByteTimeoutMs: 50,
      streamIdleTimeoutMs: 50
    });

    expect(result.content).toBe('{"sentences":[]}');
    expect(result.reasoningContent).toBe('ayrı');
    expect(result.transport).toBe('json');
  });

  it('stream beklenirken gelen düz metin response fallback ile kullanılır', async () => {
    const response = new Response('plain correction response', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });

    const result = await readCorrectionResponse(response, {
      expectedStreaming: true,
      firstByteTimeoutMs: 50,
      streamIdleTimeoutMs: 50
    });

    expect(result.content).toBe('plain correction response');
    expect(result.transport).toBe('text');
  });

  it('timeout hatası response body veya prompt taşımaz', () => {
    const error = new CorrectionResponseTimeoutError('stream-idle', {
      chunkCount: 2,
      receivedBytes: 128
    });

    expect(error).toMatchObject({
      code: 'CORRECTION_TIMEOUT',
      timeoutKind: 'stream-idle'
    });
    expect(error.diagnostics).toEqual({
      timeoutKind: 'stream-idle',
      chunkCount: 2,
      receivedBytes: 128
    });
  });
});
