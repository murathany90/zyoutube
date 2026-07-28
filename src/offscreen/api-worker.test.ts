import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const chromeMock = {
  runtime: {
    onMessage: {
      addListener: vi.fn()
    },
    sendMessage: vi.fn().mockResolvedValue({})
  }
};
(globalThis as any).chrome = chromeMock;
(globalThis as any).window = globalThis;

// Import will be hoisted anyway... wait, we need an await import inside beforeAll
let normalizeUnknownError: any;
let classifyCorrectionError: any;
let createCorrectionError: any;

beforeAll(async () => {
  const worker = await import('./api-worker');
  normalizeUnknownError = worker.normalizeUnknownError;
  classifyCorrectionError = worker.classifyCorrectionError;
  createCorrectionError = worker.createCorrectionError;
});

describe('api-worker error logic', () => {
  describe('timeout ve kullanıcı iptali ayrımı', () => {
    it('BodyStreamBuffer abort timeout flag ile CORRECTION_TIMEOUT olur', () => {
      const normalized = normalizeUnknownError(
        new DOMException('BodyStreamBuffer was aborted', 'AbortError')
      );

      const result = classifyCorrectionError(normalized, {
        timedOut: true,
        userCancelled: false,
        timeoutKind: 'total'
      });

      expect(result).toEqual({
        code: 'CORRECTION_TIMEOUT',
        stage: 'timeout',
        retryable: true
      });
    });

    it('kullanıcı iptal flag ile CORRECTION_CANCELLED olur', () => {
      const normalized = normalizeUnknownError(
        new DOMException('BodyStreamBuffer was aborted', 'AbortError')
      );

      const result = classifyCorrectionError(normalized, {
        timedOut: false,
        userCancelled: true
      });

      expect(result).toEqual({
        code: 'CORRECTION_CANCELLED',
        stage: 'cancelled',
        retryable: false
      });
    });

    it('flagsiz AbortError kullanıcı iptali sayılmaz', () => {
      const normalized = normalizeUnknownError(
        new DOMException('BodyStreamBuffer was aborted', 'AbortError')
      );

      expect(classifyCorrectionError(normalized).code).not.toBe(
        'CORRECTION_CANCELLED'
      );
    });
  });

  describe('normalizeUnknownError', () => {
    it('Error objesini dönüştürür', () => {
      const err = new Error('Test error');
      (err as any).code = 'TEST_CODE';
      (err as any).diagnostics = { foo: 'bar' };
      
      const normalized = normalizeUnknownError(err);
      expect(normalized.name).toBe('Error');
      expect(normalized.message).toBe('Test error');
      expect(normalized.code).toBe('TEST_CODE');
      expect(normalized.diagnostics).toEqual({ foo: 'bar' });
      expect(normalized.stack).toBeDefined();
    });

    it('String tipinde hatayı dönüştürür', () => {
      const normalized = normalizeUnknownError('String error message');
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('String error message');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });

    it('Object tipinde hatayı dönüştürür', () => {
      const normalized = normalizeUnknownError({ someKey: 'someValue' });
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('{"someKey":"someValue"}');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });

    it('Boş objede veya bilinmeyen tipte fallback', () => {
      const normalized = normalizeUnknownError(null);
      expect(normalized.name).toBe('NonErrorThrown');
      expect(normalized.message).toBe('null');
      expect(normalized.code).toBe('NON_ERROR_THROWN');
    });
  });

  describe('classifyCorrectionError', () => {
    it('HTTP hatalarını http_status veya http olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('Fetch failed'));
      err.code = 'HTTP_504';
      
      const classification = classifyCorrectionError(err);
      expect(classification.stage).toBe('http');

      err.code = 'HTTP_NETWORK_ERROR';
      expect(classifyCorrectionError(err).stage).toBe('http');
    });

    it('JSON hatalarını parsing olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('SyntaxError'));
      err.code = 'CORRECTION_JSON_PARSE_FAILED';
      expect(classifyCorrectionError(err).stage).toBe('parsing');
    });

    it('Schema/Validation hatalarını validation olarak sınıflandırır', () => {
      const err = normalizeUnknownError(new Error('Invalid schema'));
      err.code = 'CORRECTION_SCHEMA_INVALID';
      expect(classifyCorrectionError(err).stage).toBe('validation');

      err.code = 'CORRECTION_LANGUAGE_MISSING';
      expect(classifyCorrectionError(err).stage).toBe('validation');
    });

    it('Diğer hataları streaming olarak tanımlar', () => {
      const err = normalizeUnknownError(new Error('Streaming Error'));
      err.code = 'STREAM_READ_FAILED';
      expect(classifyCorrectionError(err).stage).toBe('streaming');
    });
  });

  describe('createCorrectionError', () => {
    it('Diagnostics ile Error nesnesi oluşturur', () => {
      const err = createCorrectionError('CORRECTION_TEST_ERROR', 'Açıklayıcı mesaj', { count: 5 });
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Açıklayıcı mesaj');
      expect((err as any).code).toBe('CORRECTION_TEST_ERROR');
      expect((err as any).diagnostics).toEqual({ count: 5 });
    });
  });
});

describe('api-worker SSE and HTTP logic', () => {
  let messageListener: any;
  let fetchMock: any;

  beforeAll(async () => {
    // Dinleyiciyi yakala
    messageListener = chromeMock.runtime.onMessage.addListener.mock.calls[0][0];
  });

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    chromeMock.runtime.sendMessage.mockClear();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });

  const sendCorrectionStart = (
    reasoning = false,
    configOverrides: Record<string, unknown> = {}
  ) => {
    return messageListener(
      {
        type: 'API_CORRECTION_START',
        taskId: 'task-1',
        videoId: 'video-1',
        request: { transcript: { segments: [{ id: '1', text: 'test' }] }, options: {}, video: { title: 'Test Video' } },
        config: {
          baseUrl: 'http://test',
          apiKey: 'key',
          model: 'test-model',
          correctionEnableReasoning: reasoning,
          stream: true,
          ...configOverrides
        }
      },
      {},
      vi.fn()
    );
  };

  const createMockStream = (chunks: string[], autoClose = true) => {
    const encoder = new TextEncoder();
    let index = 0;
    return {
      getReader: () => ({
        read: vi.fn().mockImplementation(() => {
          if (index < chunks.length) {
            return Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) });
          }
          return Promise.resolve({ done: autoClose, value: undefined });
        })
      })
    };
  };

  const validJsonContent = '{"sentences":[{"from":0,"to":0,"tr":"test","en":"test"}]}';

  it('1. [DONE] var, finish_reason yok → stream başarılı', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data: {"choices":[{"delta":{"content":${JSON.stringify(validJsonContent)}}}]}\n\n`, 'data: [DONE]\n\n'])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const completedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_COMPLETED');
     expect(completedCall).toBeDefined();
  });

  it('2. finish_reason=stop var, [DONE] yok → stream başarılı', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data: {"choices":[{"delta":{"content":${JSON.stringify(validJsonContent)}}, "finish_reason": "stop"}]}\n\n`])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const completedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_COMPLETED');
    expect(completedCall).toBeDefined();
  });

  it('3. [DONE] ve finish_reason yok → bağlantı kapanırsa stream hatası', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data: {"choices":[{"delta":{"content":"A"}}]}\n\n`])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_STREAM_READ_FAILED');
  });

  it('4. Son SSE event newline olmadan gelir → işlenir', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data: {"choices":[{"delta":{"content":${JSON.stringify(validJsonContent)}}, "finish_reason": "stop"}]}`]) // No newline
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const completedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_COMPLETED');
    expect(completedCall).toBeDefined();
  });

  it('5. data:{...} biçimi → işlenir', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data:{"choices":[{"delta":{"content":${JSON.stringify(validJsonContent)}}, "finish_reason": "stop"}]}\n\n`])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const completedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_COMPLETED');
    expect(completedCall).toBeDefined();
  });

  it('6. data: {...} biçimi → işlenir', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([`data:  {"choices":[{"delta":{"content":${JSON.stringify(validJsonContent)}}, "finish_reason": "stop"}]}\n\n`])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const completedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_COMPLETED');
    expect(completedCall).toBeDefined();
  });

  it('7. boş content → CORRECTION_EMPTY_RESPONSE', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream(['data: {"choices":[{"delta":{"content":""}, "finish_reason": "stop"}]}\n\n'])
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_EMPTY_RESPONSE');
  });

  it('8. yalnız reasoning_content → CORRECTION_FINAL_CONTENT_MISSING', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
         choices: [{ message: { reasoning_content: "thinking...", content: "" }, finish_reason: "stop" }]
      })
    });
    
    // Non-streaming for reasoning check simulation
    messageListener(
      {
        type: 'API_CORRECTION_START',
        taskId: 'task-1',
        videoId: 'video-1',
        request: { transcript: { segments: [{ id: '1', text: 'test' }] }, options: {}, video: { title: 'Test Video' } },
        config: { baseUrl: 'http://test', apiKey: 'key', model: 'test-model', correctionEnableReasoning: true, correctionStreaming: false }
      },
      {},
      vi.fn()
    );
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_FINAL_CONTENT_MISSING');
  });

  it('8b. streaming yalnız reasoning_content → CORRECTION_FINAL_CONTENT_MISSING', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: createMockStream([
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
        'data: {"choices":[{"delta":{}, "finish_reason": "stop"}]}\n\n'
      ])
    });

    sendCorrectionStart(true);
    await vi.runAllTimersAsync();

    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_FINAL_CONTENT_MISSING');
    expect(failedCall![0].error.responseCharacters).toBe(0);
  });

  it('8c. toplam timeout BodyStreamBuffer abort üretse de CORRECTION_TIMEOUT olur', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException(
            'BodyStreamBuffer was aborted',
            'AbortError'
          ));
        }, { once: true });
      });
    });

    sendCorrectionStart(false, { correctionTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);

    const failedCall = chromeMock.runtime.sendMessage.mock.calls.find(
      (call: any) => call[0].type === 'API_CORRECTION_FAILED'
    );
    expect(failedCall![0].error).toMatchObject({
      code: 'CORRECTION_TIMEOUT',
      stage: 'timeout',
      timeoutKind: 'total',
      retryable: true
    });
  });

  it('8d. API_CORRECTION_CANCEL kullanıcı iptali olarak sınıflandırılır', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException(
            'BodyStreamBuffer was aborted',
            'AbortError'
          ));
        }, { once: true });
      });
    });

    sendCorrectionStart(false, { correctionTimeoutMs: 1000 });
    messageListener(
      { type: 'API_CORRECTION_CANCEL', taskId: 'task-1' },
      {},
      vi.fn()
    );
    await vi.runAllTimersAsync();

    const failedCall = chromeMock.runtime.sendMessage.mock.calls.find(
      (call: any) => call[0].type === 'API_CORRECTION_FAILED'
    );
    expect(failedCall![0].error).toMatchObject({
      code: 'CORRECTION_CANCELLED',
      stage: 'cancelled',
      retryable: false
    });
  });

  it('9b. HTTP hata diagnostics yalniz guvenli metadata tasir', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'request-safe-123'
      }),
      text: () => Promise.resolve(JSON.stringify({
        error: {
          code: 'invalid_api_key',
          type: 'authentication_error',
          message: 'TEST_SECRET_DO_NOT_LEAK_12345'
        }
      }))
    });

    sendCorrectionStart();
    await vi.runAllTimersAsync();

    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(JSON.stringify(failedCall![0].error)).not.toContain('TEST_SECRET_DO_NOT_LEAK_12345');
    expect(failedCall![0].error.diagnostics).toMatchObject({
      httpStatus: 401,
      providerErrorCode: 'invalid_api_key',
      providerErrorType: 'authentication_error',
      requestId: 'request-safe-123',
      contentType: 'application/json'
    });
    expect(failedCall![0].error.diagnostics).not.toHaveProperty('bodyPreview');
    expect(failedCall![0].error.diagnostics).not.toHaveProperty('bodyPreviewRedacted');
  });

  it('9. HTTP 504 → CORRECTION_HTTP_504 / http', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 504,
      statusText: 'Gateway Timeout',
      headers: new Headers(),
      text: () => Promise.resolve('Timeout')
    });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_HTTP_504');
    expect(failedCall![0].error.stage).toBe('http');
  });

  it('10. object throw → logda [object Object] bulunmaz', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue({ customError: 'Something failed' });
    
    sendCorrectionStart();
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_CORRECTION_FAILED');
    expect(failedCall![0].error.code).toBe('CORRECTION_UNKNOWN'); // NonErrorThrown becomes UNKNOWN
    
    const logStr = consoleErrorSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logStr).not.toContain('[object Object]');
    consoleErrorSpy.mockRestore();
  });

  it('11. summary HTTP hatasında CORRECTION_* kodu kullanılmaz', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const secretBody = JSON.stringify({
      error: {
        code: 'provider_error',
        message: 'TEST_SECRET_DO_NOT_LEAK_67890'
      }
    });
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Error',
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'summary-request-123'
      }),
      text: () => Promise.resolve(secretBody)
    });
    
    messageListener(
      {
        type: 'API_SUMMARY_START',
        taskId: 'task-sum-1',
        videoId: 'video-1',
        request: { transcript: { segments: [] }, options: {}, video: { title: 'Test Video' } },
        config: { baseUrl: 'http://test', apiKey: 'key', model: 'test-model' }
      },
      {},
      vi.fn()
    );
    await vi.runAllTimersAsync();
    
    const calls = chromeMock.runtime.sendMessage.mock.calls;
    const failedCall = calls.find((c: any) => c[0].type === 'API_SUMMARY_FAILED');
    expect(failedCall![0].error.code).toBe('API_ERROR'); // NOT CORRECTION_HTTP_ERROR
    expect(JSON.stringify(failedCall![0].error)).not.toContain(
      'TEST_SECRET_DO_NOT_LEAK_67890'
    );
    expect(failedCall![0].error.diagnostics).toMatchObject({
      httpStatus: 500,
      providerErrorCode: 'provider_error',
      requestId: 'summary-request-123',
      contentType: 'application/json'
    });
    expect(
      consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n')
    ).not.toContain('TEST_SECRET_DO_NOT_LEAK_67890');
    consoleLogSpy.mockRestore();
  });
});
