import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible-provider';

import { AISettingsService } from '../../settings/ai-settings';

vi.mock('../../settings/ai-settings', () => ({
  AISettingsService: {
    getProviderConfig: vi.fn(),
  }
}));

describe('OpenAICompatibleProvider Boundary Tests', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider();
    vi.clearAllMocks();
    (AISettingsService.getProviderConfig as any).mockResolvedValue({
      apiKey: 'dummy-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4'
    });
  });

  const dummyRequest: any = {
    taskId: '123',
    video: { videoId: 'vid' },
    transcript: { segments: [{ text: 'hello', cleanText: 'hello', startTimeMs: 0, endTimeMs: 1000 }] },
    options: { outputLanguage: 'tr', length: 'short' }
  };

  it('should throw PERMISSION_REQUIRED if no API key or Base URL', async () => {
    (AISettingsService.getProviderConfig as any).mockResolvedValue({});
    
    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('PROVIDER_NOT_CONFIGURED');
    }
  });

  it('should handle 401 INVALID_API_KEY', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: async () => ({ error: { message: 'Incorrect API key' } }),
      text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('INVALID_API_KEY');
      expect(e.retryable).toBe(false);
    }
  });

  it('should handle 429 RATE_LIMITED', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => '1' },
      json: async () => ({ error: { message: 'Quota exceeded' } }),
      text: async () => JSON.stringify({ error: { message: 'Quota exceeded' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('QUOTA_EXCEEDED');
      expect(e.retryable).toBe(true);
    }
  });

  it('should handle 404 MODEL_NOT_FOUND', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ error: { message: 'Model not found' } }),
      text: async () => JSON.stringify({ error: { message: 'Model not found' } })
    });

    try {
      await provider.summarize(dummyRequest, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('MODEL_NOT_FOUND');
    }
  });

  it('should handle empty response or invalid JSON gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{ bad json }' } }]
      })
    });

    const res = await provider.summarize(dummyRequest, {});
    // Fallback parser should handle it
    expect(res.rawResponseStored).toBe(true);
  });

  it('should handle network timeout via AbortSignal', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));
    const controller = new AbortController();
    controller.abort();

    try {
      await provider.summarize(dummyRequest, { signal: controller.signal });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.code).toBe('REQUEST_CANCELLED');
    }
  });

  it('tests the selected summary request format without returning response content', async () => {
    (AISettingsService.getProviderConfig as any).mockResolvedValue({
      apiKey: 'dummy-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
      maxTokens: 512,
      summaryTokenParam: 'max_completion_tokens',
      summaryStreaming: false,
      summaryJsonMode: true
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: { tr: 'Güvenli test özeti' },
            keyIdeas: [],
            sections: [],
            actionItems: [],
            importantTerms: [],
            warnings: []
          })
        },
        finish_reason: 'stop'
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await provider.testConnection(undefined, 'summary');
    const requestBody = JSON.parse(
      (globalThis.fetch as any).mock.calls[0][1].body
    );

    expect(result.success).toBe(true);
    expect(result.message).not.toContain('Güvenli test özeti');
    expect(requestBody.max_completion_tokens).toBe(512);
    expect(requestBody.max_tokens).toBeUndefined();
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
  });

  it('tests the selected correction request format', async () => {
    (AISettingsService.getProviderConfig as any).mockResolvedValue({
      apiKey: 'dummy-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
      correctionMaxTokens: 1024,
      correctionTokenParam: 'max_tokens',
      correctionStreaming: false,
      correctionJsonMode: true
    });
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            sentences: [{
              from: 0,
              to: 0,
              tr: 'Bu bir testtir.',
              en: 'This is a test.'
            }]
          })
        },
        finish_reason: 'stop'
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    const result = await provider.testConnection(undefined, 'correction');
    const requestBody = JSON.parse(
      (globalThis.fetch as any).mock.calls[0][1].body
    );

    expect(result.success).toBe(true);
    expect(requestBody.max_tokens).toBe(1024);
    expect(requestBody.stream).toBeUndefined();
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
  });

  it('does not use reasoning_content as the final summary', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '',
          reasoning_content: 'Private reasoning is not a final answer.'
        },
        finish_reason: 'stop'
      }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    await expect(provider.summarize(dummyRequest, {})).rejects.toMatchObject({
      code: 'INVALID_RESPONSE'
    });
  });

  it('does not expose an HTTP error response body in diagnostics', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'provider_error',
        message: 'secret response detail'
      }
    }), {
      status: 500,
      statusText: 'Server Error',
      headers: { 'content-type': 'application/json' }
    }));

    try {
      await provider.summarize(dummyRequest, {});
      expect.fail('Expected provider error');
    } catch (error: any) {
      expect(error.debugMessage || '').not.toContain('secret response detail');
      expect(error.statusCode).toBe(500);
    }
  });
});
