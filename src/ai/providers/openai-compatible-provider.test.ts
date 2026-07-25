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
      json: async () => ({ error: { message: 'Incorrect API key' } })
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
      json: async () => ({ error: { message: 'Quota exceeded' } })
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
      json: async () => ({ error: { message: 'Model not found' } })
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
    expect(res.rawResponseStored).toBe(false);
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
});
